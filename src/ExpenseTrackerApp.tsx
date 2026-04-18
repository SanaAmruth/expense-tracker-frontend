import { Audio } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import { supabase } from "./supabase";

import {
  categories as defaultCategories,
  defaultBudgets,
  defaultPaymentProfile,
  initialExpenses,
  paymentModes
} from "./data";
import { colors, spacing } from "./theme";
import {
  Budget,
  Category,
  Expense,
  PaymentInstrument,
  PaymentMode,
  PaymentProfile
} from "./types";
import {
  buildInsights,
  formatCurrency,
  formatDateFriendly,
  formatTimeFriendly,
  getBudgetStatus,
  getCurrentExpenseStamp,
  getDisplayLabel,
  getMonthTotal,
  getPaymentSources,
  getTransactionsForDate,
  getTransactionsForMonth,
  groupByCategory,
  groupByMonth,
  smartParseExpense
} from "./utils";

type Screen = "Home" | "History" | "Budgets" | "Insights";
type HomeSegment = "Calendar" | "Recent";
type AddExpenseMethod = "Voice" | "Manual";
type VoiceState = "idle" | "recording" | "processing" | "done" | "error";

const STORAGE_KEY = "expense_tracker_state_v1";

// ─── Backend URL ─────────────────────────────────────────────────────────────
// For local dev:
const VOICE_API_URL = "http://localhost:8000/voice-expense";
// For production, replace with your Railway URL:
// const VOICE_API_URL = "https://YOUR_APP.up.railway.app/voice-expense";

type AuthMode = "required" | "offline";

type DraftExpense = {
  amount: string;
  merchant: string;
  paymentMode: PaymentMode | "";
  paymentSource: string;
  category: Category;
  comment: string;
};

type OnboardingChip = {
  id: string;
  label: string;
};

const formatPaymentSource = (instrument: PaymentInstrument) =>
  instrument.accountLabel
    ? `${instrument.label} • ${instrument.accountLabel}`
    : instrument.label;

const createDraft = (
  _profile: PaymentProfile,
  _categories: Category[]
): DraftExpense => {
  return {
    amount: "",
    merchant: "",
    paymentMode: "",
    paymentSource: "",
    category: "",
    comment: ""
  };
};

const makeChip = (prefix: string, value: string, index: number): OnboardingChip => ({
  id: `${prefix}-${index}-${value.toLowerCase().replace(/\s+/g, "-")}`,
  label: value
});

const buildProfile = ({
  cashEnabled,
  directBankEnabled,
  upiBanks,
  cardNames
}: {
  cashEnabled: boolean;
  directBankEnabled: boolean;
  upiBanks: OnboardingChip[];
  cardNames: OnboardingChip[];
}): PaymentProfile => ({
  cashEnabled,
  upiAccounts: upiBanks.map((item) => ({
    id: `upi-${item.id}`,
    label: item.label,
    accountLabel: "UPI"
  })),
  cards: cardNames.map((item) => ({
    id: `card-${item.id}`,
    label: item.label,
    accountLabel: "Card"
  })),
  bankAccounts: directBankEnabled
    ? upiBanks.map((item) => ({
        id: `bank-${item.id}`,
        label: item.label,
        accountLabel: "NetBanking"
      }))
    : []
});

const makeExpense = (draft: DraftExpense): Expense => ({
  ...getCurrentExpenseStamp(),
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  amount: Number(draft.amount),
  merchant: draft.merchant.trim(),
  paymentMode: draft.paymentMode,
  paymentSource: draft.paymentSource.trim(),
  category: draft.category.trim(),
  comment: draft.comment
});

const toLocalStamp = (value: string) => {
  const date = new Date(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}` };
};

export function ExpenseTrackerApp() {
  const [authMode, setAuthMode] = useState<AuthMode>("required");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [session, setSession] = useState<any>(null);

  const [screen, setScreen] = useState<Screen>("Home");
  const [homeSegment, setHomeSegment] = useState<HomeSegment>("Calendar");
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [profile, setProfile] = useState<PaymentProfile>(defaultPaymentProfile);
  const [budgets, setBudgets] = useState<Budget[]>(defaultBudgets);
  const [userCategories, setUserCategories] = useState<Category[]>(defaultCategories);
  const [isOnboarded, setIsOnboarded] = useState(false);
  const hasLoadedPersistedState = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw) {
          hasLoadedPersistedState.current = true;
          return;
        }

        const parsed = JSON.parse(raw) as Partial<{
          expenses: Expense[];
          profile: PaymentProfile;
          budgets: Budget[];
          userCategories: Category[];
          isOnboarded: boolean;
        }>;

        if (cancelled) return;
        if (Array.isArray(parsed.expenses)) setExpenses(parsed.expenses);
        if (parsed.profile) setProfile(parsed.profile);
        if (Array.isArray(parsed.budgets)) setBudgets(parsed.budgets);
        if (Array.isArray(parsed.userCategories)) setUserCategories(parsed.userCategories);
        if (typeof parsed.isOnboarded === "boolean") setIsOnboarded(parsed.isOnboarded);
      } catch {
        // Ignore corrupted storage; app will fall back to defaults.
      } finally {
        hasLoadedPersistedState.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasLoadedPersistedState.current) return;
    const timer = setTimeout(() => {
      const payload = JSON.stringify({
        expenses,
        profile,
        budgets,
        userCategories,
        isOnboarded
      });
      AsyncStorage.setItem(STORAGE_KEY, payload).catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [expenses, profile, budgets, userCategories, isOnboarded]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setSession(data.session);
    })();
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = async () => {
    const email = authEmail.trim();
    const password = authPassword;
    if (!email || !password) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err: any) {
      setAuthError(err?.message ?? "Could not sign in.");
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (err: any) {
      setAuthError(err?.message ?? "Could not sign out.");
    } finally {
      setAuthBusy(false);
    }
  };

  const fetchCloudExpenses = async () => {
    if (!session?.user?.id) return;
    const { data, error } = await supabase
      .from("expenses")
      .select("id, user_id, amount, merchant, payment_mode, payment_source, category, comment, occurred_at")
      .order("occurred_at", { ascending: false });
    if (error) throw error;
    const mapped = (data ?? []).map((row: any) => {
      const stamp = toLocalStamp(row.occurred_at);
      return {
        id: row.id,
        amount: Number(row.amount) || 0,
        merchant: row.merchant ?? "",
        date: stamp.date,
        time: stamp.time,
        paymentMode: (row.payment_mode ?? "") as PaymentMode,
        paymentSource: row.payment_source ?? "",
        category: row.category ?? "",
        comment: row.comment ?? ""
      } satisfies Expense;
    });
    setExpenses(mapped);
  };

  useEffect(() => {
    if (!session?.user?.id) return;
    fetchCloudExpenses().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  // Onboarding state
  const [upiBanks, setUpiBanks] = useState<OnboardingChip[]>([]);
  const [cardNames, setCardNames] = useState<OnboardingChip[]>([]);
  const [newUpiBankName, setNewUpiBankName] = useState("");
  const [newCardName, setNewCardName] = useState("");

  const [customCategory, setCustomCategory] = useState("");
  const [addExpenseMethod, setAddExpenseMethod] = useState<AddExpenseMethod>("Voice");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftExpense>(
    createDraft(defaultPaymentProfile, defaultCategories)
  );

  // ─── Voice recording state ─────────────────────────────────────────────────
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceError, setVoiceError] = useState("");

  // Native (expo-av) ref
  const recordingRef = useRef<Audio.Recording | null>(null);

  // Web (MediaRecorder) refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  const upsertExpense = async (draftExpense: DraftExpense) => {
    if (!session?.user?.id) {
      setExpenses((current) => [makeExpense(draftExpense), ...current]);
      return;
    }

    const payload = {
      user_id: session.user.id,
      amount: Number(draftExpense.amount) || null,
      merchant: draftExpense.merchant.trim() || null,
      payment_mode: draftExpense.paymentMode || null,
      payment_source: draftExpense.paymentSource.trim() || null,
      category: draftExpense.category.trim() || null,
      comment: draftExpense.comment || null,
      occurred_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("expenses")
      .insert(payload)
      .select("id, amount, merchant, payment_mode, payment_source, category, comment, occurred_at")
      .single();
    if (error) throw error;

    const stamp = toLocalStamp(data.occurred_at);
    const expense: Expense = {
      id: data.id,
      amount: Number(data.amount) || 0,
      merchant: data.merchant ?? "",
      date: stamp.date,
      time: stamp.time,
      paymentMode: (data.payment_mode ?? "") as PaymentMode,
      paymentSource: data.payment_source ?? "",
      category: data.category ?? "",
      comment: data.comment ?? ""
    };

    setExpenses((current) => [expense, ...current]);
  };

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.18,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true
        })
      ])
    ).start();
  };

  const stopPulse = () => {
    pulseAnim.stopAnimation();
    Animated.timing(pulseAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true
    }).start();
  };

  // ─── Shared: handle API response ──────────────────────────────────────────
  const handleApiResponse = async (res: Response) => {
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error((errData as any).detail ?? `Server error ${res.status}`);
    }

    const data = await res.json() as {
      transcript: string;
      amount: string;
      merchant: string;
      payment_mode: string;
      payment_source: string;
      category: string;
      comment: string;
    };

    setVoiceTranscript(data.transcript);

    const paymentModeValue = (["Cash", "UPI", "Card", "Bank"] as const).includes(
      data.payment_mode as any
    ) ? (data.payment_mode as "Cash" | "UPI" | "Card" | "Bank") : "";

    const newDraft: DraftExpense = {
      amount: data.amount !== "NA" ? data.amount : "",
      merchant: data.merchant !== "NA" ? data.merchant : "",
      paymentMode: paymentModeValue,
      paymentSource: data.payment_source !== "NA" ? data.payment_source : "",
      category: data.category !== "Miscellaneous" ? data.category : "",
      comment: data.comment !== "NA" ? data.comment : ""
    };

    setVoiceState("done");

    if (newDraft.amount && Number(newDraft.amount) > 0) {
      await upsertExpense(newDraft);
      setTimeout(() => {
        setVoiceState("idle");
        setVoiceTranscript("");
      }, 2000);
    } else {
      setDraft(newDraft);
      setVoiceState("idle");
      setVoiceTranscript("");
      setAddExpenseMethod("Manual");
    }
  };

  // ─── WEB: MediaRecorder ───────────────────────────────────────────────────
  const startRecordingWeb = async () => {
    try {
      setVoiceError("");
      setVoiceTranscript("");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.start();
      setVoiceState("recording");
      startPulse();
    } catch (err: any) {
      const msg = err?.name === "NotAllowedError"
        ? "Microphone permission denied. Click the 🔒 icon in your browser address bar to allow it."
        : "Could not access microphone. Please try again.";
      setVoiceError(msg);
      setVoiceState("error");
    }
  };

  const stopRecordingAndProcessWeb = () => {
    const mediaRecorder = mediaRecorderRef.current;
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;

    stopPulse();
    setVoiceState("processing");

    mediaRecorder.onstop = async () => {
      // Stop all mic tracks to release the browser mic indicator
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;

      const mimeType = audioChunksRef.current[0]?.type || "audio/webm";
      const blob = new Blob(audioChunksRef.current, { type: mimeType });
      audioChunksRef.current = [];

      const formData = new FormData();
      formData.append("audio", blob, "recording.webm");

      try {
        const res = await fetch(VOICE_API_URL, { method: "POST", body: formData });
        await handleApiResponse(res);
      } catch (err: any) {
        setVoiceError(err?.message ?? "Something went wrong. Please try again.");
        setVoiceState("error");
      }
    };

    mediaRecorder.stop();
  };

  // ─── NATIVE: expo-av ──────────────────────────────────────────────────────
  const startRecordingNative = async () => {
    try {
      setVoiceError("");
      setVoiceTranscript("");
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        setVoiceError("Microphone permission denied. Please enable it in Settings.");
        setVoiceState("error");
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setVoiceState("recording");
      startPulse();
    } catch (err) {
      setVoiceError("Could not start recording. Please try again.");
      setVoiceState("error");
    }
  };

  const stopRecordingAndProcessNative = async () => {
    const recording = recordingRef.current;
    if (!recording) return;

    stopPulse();
    setVoiceState("processing");

    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      recordingRef.current = null;

      if (!uri) throw new Error("Recording URI missing.");

      const formData = new FormData();
      // @ts-ignore – React Native FormData accepts {uri, name, type}
      formData.append("audio", { uri, name: "recording.m4a", type: "audio/m4a" });

      const res = await fetch(VOICE_API_URL, { method: "POST", body: formData });
      await handleApiResponse(res);
    } catch (err: any) {
      setVoiceError(err?.message ?? "Something went wrong. Please try again.");
      setVoiceState("error");
      recordingRef.current = null;
    }
  };

  // ─── Platform-aware wrappers ──────────────────────────────────────────────
  const isWeb = typeof navigator !== "undefined" && navigator.product !== "ReactNative";
  const startRecording = isWeb ? startRecordingWeb : startRecordingNative;
  const stopRecordingAndProcess = isWeb ? stopRecordingAndProcessWeb : stopRecordingAndProcessNative;


  const currentStamp = getCurrentExpenseStamp();
  const currentMonthKey = currentStamp.date.slice(0, 7);
  const availableCategories = useMemo(
    () =>
      Array.from(
        new Set([...userCategories, ...expenses.map((expense) => expense.category)])
      ),
    [expenses, userCategories]
  );
  const activeSources = useMemo(() => {
    if (!draft.paymentMode) return [];
    return getPaymentSources(profile, draft.paymentMode);
  }, [draft.paymentMode, profile]);
  const monthTotal = useMemo(
    () => getMonthTotal(expenses, currentMonthKey),
    [currentMonthKey, expenses]
  );
  const categoryStats = useMemo(() => groupByCategory(expenses), [expenses]);
  const monthStats = useMemo(() => groupByMonth(expenses), [expenses]);
  const budgetStats = useMemo(
    () => getBudgetStatus(expenses, budgets),
    [expenses, budgets]
  );
  const insights = useMemo(() => buildInsights(expenses), [expenses]);

  const syncMode = (paymentMode: PaymentMode) => {
    const sources = getPaymentSources(profile, paymentMode);
    setDraft((current) => ({
      ...current,
      paymentMode,
      paymentSource: sources[0] ? formatPaymentSource(sources[0]) : ""
    }));
  };

  const addExpense = () => {
    const numericAmount = Number(draft.amount);
    if (!draft.amount.trim() || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return;
    }
    upsertExpense(draft).catch(() => {});
    setDraft({
      amount: "",
      merchant: "",
      paymentMode: "",
      paymentSource: "",
      category: "",
      comment: ""
    });
    setAddExpenseMethod("Voice");
  };

  // Legacy text-based parsing (kept for internal use / fallback)
  const parseVoiceEntry = () => {};
  const parseAndAddVoiceEntry = () => {};

  const addCustomCategory = () => {
    const nextCategory = customCategory.trim();
    if (!nextCategory) {
      return;
    }
    if (!userCategories.includes(nextCategory)) {
      setUserCategories((current) => [...current, nextCategory]);
    }
    setDraft((current) => ({ ...current, category: nextCategory }));
    setCustomCategory("");
  };

  const addUpiBank = () => {
    const value = newUpiBankName.trim();
    if (!value) return;
    if (upiBanks.some((b) => b.label.toLowerCase() === value.toLowerCase())) {
      setNewUpiBankName("");
      return;
    }
    setUpiBanks((current) => [...current, makeChip("upi-bank", value, current.length)]);
    setNewUpiBankName("");
  };

  const removeUpiBank = (id: string) =>
    setUpiBanks((current) => current.filter((b) => b.id !== id));

  const addCard = () => {
    const value = newCardName.trim();
    if (!value) return;
    if (cardNames.some((c) => c.label.toLowerCase() === value.toLowerCase())) {
      setNewCardName("");
      return;
    }
    setCardNames((current) => [...current, makeChip("card", value, current.length)]);
    setNewCardName("");
  };

  const removeCard = (id: string) =>
    setCardNames((current) => current.filter((c) => c.id !== id));

  const finishOnboarding = () => {
    const nextProfile = buildProfile({
      cashEnabled: true,
      directBankEnabled: true,
      upiBanks,
      cardNames
    });
    const nextBudgets: Budget[] = userCategories.map((category) => ({
      category,
      limit: 0
    }));
    setProfile(nextProfile);
    setBudgets(nextBudgets);
    setDraft(createDraft(nextProfile, userCategories));
    setIsOnboarded(true);
  };

  const updateBudget = (category: Category, value: string) => {
    const numeric = Number(value.replace(/[^0-9.]/g, "")) || 0;
    setBudgets((current) => {
      const found = current.find((b) => b.category === category);
      if (found) {
        return current.map((b) =>
          b.category === category ? { ...b, limit: numeric } : b
        );
      }
      return [...current, { category, limit: numeric }];
    });
  };

  const deleteExpense = (id: string) => {
    setExpenses((current) => current.filter((e) => e.id !== id));
    setEditingId((current) => (current === id ? null : current));
    if (session?.user?.id) {
      void (async () => {
        await supabase.from("expenses").delete().eq("id", id);
      })();
    }
  };

  const updateExpense = (id: string, patch: Partial<Expense>) => {
    setExpenses((current) =>
      current.map((expense) =>
        expense.id === id
          ? {
              ...expense,
              ...patch,
              amount:
                patch.amount !== undefined
                  ? Number(patch.amount) || 0
                  : expense.amount,
              merchant:
                patch.merchant !== undefined
                  ? patch.merchant.trim()
                  : expense.merchant,
              category:
                patch.category !== undefined
                  ? patch.category.trim()
                  : expense.category
            }
          : expense
      )
    );

    if (session?.user?.id) {
      const payload: any = {};
      if (patch.amount !== undefined) payload.amount = Number(patch.amount) || 0;
      if (patch.merchant !== undefined) payload.merchant = patch.merchant.trim();
      if (patch.paymentMode !== undefined) payload.payment_mode = patch.paymentMode;
      if (patch.paymentSource !== undefined) payload.payment_source = patch.paymentSource.trim();
      if (patch.category !== undefined) payload.category = patch.category.trim();
      if (patch.comment !== undefined) payload.comment = patch.comment;
      if (Object.keys(payload).length > 0) {
        void (async () => {
          await supabase.from("expenses").update(payload).eq("id", id);
        })();
      }
    }
  };

  const editingExpense = useMemo(
    () => expenses.find((expense) => expense.id === editingId) ?? null,
    [editingId, expenses]
  );

  if (!session && authMode !== "offline") {
    return (
      <View style={styles.app}>
        <View style={[styles.card, { maxWidth: 520, alignSelf: "center" }]}>
          <Text style={styles.heroTitle}>Sign in to sync</Text>
          <Text style={styles.voiceHint}>
            Sign in with the email + password you created in Supabase.
          </Text>
          <Text style={styles.fieldLabel}>EMAIL</Text>
          <TextInput
            style={styles.input}
            value={authEmail}
            onChangeText={setAuthEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>PASSWORD</Text>
          <TextInput
            style={styles.input}
            value={authPassword}
            onChangeText={setAuthPassword}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
          />
          {!!authError && <Text style={[styles.helperText, { color: "#ffb4b4" }]}>{authError}</Text>}
          <Pressable
            onPress={() => signIn().catch(() => {})}
            style={[styles.primaryButton, authBusy && { opacity: 0.6 }]}
            disabled={authBusy}
          >
            <Text style={styles.primaryButtonText}>
              {authBusy ? "Signing in…" : "Sign in"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setAuthMode("offline")}
            style={[styles.secondaryButton, { marginTop: 12 }]}
          >
            <Text style={styles.secondaryButtonText}>Continue offline</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!isOnboarded) {
    return (
      <OnboardingScreen
        upiBanks={upiBanks}
        cardNames={cardNames}
        newUpiBankName={newUpiBankName}
        newCardName={newCardName}
        onChangeNewUpiBank={setNewUpiBankName}
        onAddUpiBank={addUpiBank}
        onRemoveUpiBank={removeUpiBank}
        onChangeNewCard={setNewCardName}
        onAddCard={addCard}
        onRemoveCard={removeCard}
        onFinish={finishOnboarding}
      />
    );
  }

  return (
    <View style={styles.app}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {screen === "Home" ? (
          <>
            <View style={styles.hero}>
              <View style={styles.heroHeader}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.heroCaption}>QUICK ADD</Text>
                  <Text style={styles.heroTitle}>Log an expense</Text>
                </View>
                <View style={styles.monthSpentPill}>
                  <Text
                    style={styles.monthSpentText}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {formatCurrency(monthTotal)}
                  </Text>
                  <Text style={styles.monthSpentSub}>this month</Text>
                </View>
              </View>

              <View style={styles.entryMethodCard}>
                <Text style={styles.fieldLabel}>ADD EXPENSE USING</Text>
                <View style={styles.entryMethodRow}>
                  {(["Voice", "Manual"] as AddExpenseMethod[]).map((method) => (
                    <Pressable
                      key={method}
                      onPress={() => setAddExpenseMethod(method)}
                      style={[
                        styles.entryMethodButton,
                        addExpenseMethod === method && styles.entryMethodButtonActive
                      ]}
                    >
                      <Text
                        style={[
                          styles.entryMethodButtonText,
                          addExpenseMethod === method &&
                            styles.entryMethodButtonTextActive
                        ]}
                      >
                        {method}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {addExpenseMethod === "Voice" ? (
                <View style={styles.voiceHero}>
                  {/* ── Idle ─────────────────────────────────────────── */}
                  {voiceState === "idle" && (
                    <>
                      <Text style={styles.voiceTitle}>Tap to speak</Text>
                      <Text style={styles.voiceHint}>
                        Hold the mic, say your expense, then tap again to stop.
                      </Text>
                      <Pressable
                        style={({ pressed }) => [
                          styles.micButton,
                          pressed && styles.pressed
                        ]}
                        onPress={startRecording}
                      >
                        <Text style={styles.micIcon}>🎙️</Text>
                        <Text style={styles.micLabel}>Start recording</Text>
                      </Pressable>
                    </>
                  )}

                  {/* ── Recording ────────────────────────────────────── */}
                  {voiceState === "recording" && (
                    <>
                      <Text style={styles.voiceTitle}>Recording…</Text>
                      <Text style={styles.voiceHint}>Speak now, then tap to stop.</Text>
                      <Animated.View
                        style={[
                          styles.micButton,
                          styles.micButtonRecording,
                          { transform: [{ scale: pulseAnim }] }
                        ]}
                      >
                        <Pressable
                          style={styles.micButtonInner}
                          onPress={stopRecordingAndProcess}
                        >
                          <Text style={styles.micIcon}>⏹️</Text>
                          <Text style={[styles.micLabel, { color: "#fff" }]}>Tap to stop</Text>
                        </Pressable>
                      </Animated.View>
                    </>
                  )}

                  {/* ── Processing ───────────────────────────────────── */}
                  {voiceState === "processing" && (
                    <View style={styles.voiceStatusBox}>
                      <ActivityIndicator size="large" color={colors.accent} />
                      <Text style={styles.voiceStatusText}>Transcribing…</Text>
                      <Text style={styles.voiceStatusSub}>Sending to AI, this takes a few seconds</Text>
                    </View>
                  )}

                  {/* ── Done / saved ─────────────────────────────────── */}
                  {voiceState === "done" && (
                    <View style={styles.voiceStatusBox}>
                      <Text style={styles.voiceDoneIcon}>✅</Text>
                      <Text style={styles.voiceStatusText}>Expense saved!</Text>
                      {voiceTranscript ? (
                        <Text style={styles.voiceTranscript}>"{voiceTranscript}"</Text>
                      ) : null}
                    </View>
                  )}

                  {/* ── Error ────────────────────────────────────────── */}
                  {voiceState === "error" && (
                    <View style={styles.voiceStatusBox}>
                      <Text style={styles.voiceErrorIcon}>⚠️</Text>
                      <Text style={styles.voiceStatusText}>Couldn't process</Text>
                      <Text style={styles.voiceStatusSub}>{voiceError}</Text>
                      <Pressable
                        style={({ pressed }) => [
                          styles.primaryButton,
                          { marginTop: 16 },
                          pressed && styles.pressed
                        ]}
                        onPress={() => {
                          setVoiceState("idle");
                          setVoiceError("");
                        }}
                      >
                        <Text style={styles.primaryButtonText}>Try again</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.manualSection}>
                  <View style={styles.manualHeader}>
                    <Text style={styles.manualTitle}>Manual expense</Text>
                  </View>
                  <Text style={styles.manualMeta}>
                    Stamps {currentStamp.date} at {currentStamp.time}
                  </Text>

                  <View style={styles.amountRow}>
                    <Text style={styles.currencyMark}>₹</Text>
                    <TextInput
                      value={draft.amount}
                      onChangeText={(amount) =>
                        setDraft((current) => ({ ...current, amount }))
                      }
                      placeholder="Enter amount"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="numeric"
                      style={styles.amountInput}
                    />
                  </View>

                  <View style={styles.sectionShell}>
                    <Text style={styles.fieldLabel}>MERCHANT (OPTIONAL)</Text>
                    <TextInput
                      value={draft.merchant}
                      onChangeText={(merchant) =>
                        setDraft((current) => ({ ...current, merchant }))
                      }
                      placeholder="Leave blank to log as Miscellaneous"
                      placeholderTextColor={colors.textMuted}
                      style={[styles.input, styles.inlineFieldInput]}
                    />
                  </View>

                  <View style={styles.sectionShell}>
                    <Text style={styles.fieldLabel}>PAYMENT MODE (OPTIONAL)</Text>
                    <View style={styles.categoryRow}>
                      {paymentModes.map((mode) => (
                        <Pressable
                          key={mode}
                          onPress={() => syncMode(mode)}
                          style={[
                            styles.categoryPill,
                            draft.paymentMode === mode && styles.categoryPillActive
                          ]}
                        >
                          <Text
                            style={[
                              styles.categoryText,
                              draft.paymentMode === mode && styles.categoryTextActive
                            ]}
                          >
                            {mode}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>

                  {draft.paymentMode && activeSources.length > 0 ? (
                    <View style={styles.sectionShell}>
                      <Text style={styles.fieldLabel}>PAYMENT SOURCE</Text>
                      <View style={styles.categoryRow}>
                        {activeSources.map((source) => {
                          const formatted = formatPaymentSource(source);
                          return (
                            <Pressable
                              key={source.id}
                              onPress={() =>
                                setDraft((current) => ({
                                  ...current,
                                  paymentSource: formatted
                                }))
                              }
                              style={[
                                styles.categoryPill,
                                draft.paymentSource === formatted &&
                                  styles.categoryPillActive
                              ]}
                            >
                              <Text
                                style={[
                                  styles.categoryText,
                                  draft.paymentSource === formatted &&
                                    styles.categoryTextActive
                                ]}
                              >
                                {formatted}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  ) : draft.paymentMode ? (
                    <View style={styles.sectionShell}>
                      <Text style={styles.fieldLabel}>PAYMENT SOURCE</Text>
                      <Text style={styles.helperText}>
                        No {draft.paymentMode} sources added. Pick a different mode
                        or add one in settings.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.sectionShell}>
                      <Text style={styles.fieldLabel}>PAYMENT SOURCE (OPTIONAL)</Text>
                      <Text style={styles.helperText}>
                        Select a payment mode to choose a source.
                      </Text>
                    </View>
                  )}

                  <View style={styles.sectionShell}>
                    <Text style={styles.fieldLabel}>CATEGORY (OPTIONAL)</Text>
                    <View style={styles.categoryRow}>
                      {availableCategories.map((category) => (
                        <Pressable
                          key={category}
                          onPress={() =>
                            setDraft((current) => ({
                              ...current,
                              category: current.category === category ? "" : category
                            }))
                          }
                          style={[
                            styles.categoryPill,
                            draft.category === category && styles.categoryPillActive
                          ]}
                        >
                          <Text
                            style={[
                              styles.categoryText,
                              draft.category === category && styles.categoryTextActive
                            ]}
                          >
                            {category}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.customCategoryRow}>
                      <TextInput
                        value={customCategory}
                        onChangeText={setCustomCategory}
                        placeholder="Create custom category"
                        placeholderTextColor={colors.textMuted}
                        style={[styles.input, styles.customCategoryInput]}
                      />
                      <Pressable
                        style={({ pressed }) => [
                          styles.inlineButton,
                          pressed && styles.pressed
                        ]}
                        onPress={addCustomCategory}
                      >
                        <Text style={styles.primaryButtonText}>Add</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.sectionShell}>
                    <Text style={styles.fieldLabel}>COMMENT</Text>
                    <TextInput
                      value={draft.comment}
                      onChangeText={(comment) =>
                        setDraft((current) => ({ ...current, comment }))
                      }
                      placeholder="Optional note"
                      placeholderTextColor={colors.textMuted}
                      style={[styles.input, styles.inlineFieldInput]}
                    />
                  </View>

                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryButton,
                      pressed && styles.pressed
                    ]}
                    onPress={addExpense}
                  >
                    <Text style={styles.primaryButtonText}>Save expense</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <View style={styles.segmentRow}>
              {(["Calendar", "Recent"] as HomeSegment[]).map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setHomeSegment(item)}
                  style={styles.segmentButton}
                >
                  <Text
                    style={[
                      styles.segmentLabel,
                      homeSegment === item && styles.segmentLabelActive
                    ]}
                  >
                    {item}
                  </Text>
                  {homeSegment === item ? (
                    <View style={styles.segmentUnderline} />
                  ) : null}
                </Pressable>
              ))}
            </View>

            {homeSegment === "Calendar" ? (
              <CalendarHeatmap
                expenses={expenses}
                onEditExpense={(id) => setEditingId(id)}
              />
            ) : (
              <RecentList
                expenses={expenses}
                onDelete={deleteExpense}
                onEdit={(id) => setEditingId(id)}
              />
            )}
          </>
        ) : screen === "History" ? (
          <HistoryScreen
            expenses={expenses}
            onEdit={(id) => setEditingId(id)}
          />
        ) : screen === "Budgets" ? (
          <BudgetsScreen
            budgetStats={budgetStats}
            categories={availableCategories}
            onUpdate={updateBudget}
          />
        ) : (
          <InsightsScreen
            categoryStats={categoryStats}
            monthStats={monthStats}
            insights={insights}
          />
        )}
      </ScrollView>

      <View style={styles.bottomNav}>
        {(["Home", "History", "Budgets", "Insights"] as Screen[]).map((item) => (
          <Pressable key={item} style={styles.navItem} onPress={() => setScreen(item)}>
            <Text style={[styles.navLabel, screen === item && styles.navLabelActive]}>
              {item}
            </Text>
          </Pressable>
        ))}
      </View>

      <EditExpenseModal
        expense={editingExpense}
        profile={profile}
        availableCategories={availableCategories}
        onClose={() => setEditingId(null)}
        onSave={(patch) => {
          if (editingExpense) {
            updateExpense(editingExpense.id, patch);
          }
          setEditingId(null);
        }}
        onDelete={(id) => {
          deleteExpense(id);
          setEditingId(null);
        }}
      />
    </View>
  );
}

function OnboardingScreen({
  upiBanks,
  cardNames,
  newUpiBankName,
  newCardName,
  onChangeNewUpiBank,
  onAddUpiBank,
  onRemoveUpiBank,
  onChangeNewCard,
  onAddCard,
  onRemoveCard,
  onFinish
}: {
  upiBanks: OnboardingChip[];
  cardNames: OnboardingChip[];
  newUpiBankName: string;
  newCardName: string;
  onChangeNewUpiBank: (value: string) => void;
  onAddUpiBank: () => void;
  onRemoveUpiBank: (id: string) => void;
  onChangeNewCard: (value: string) => void;
  onAddCard: () => void;
  onRemoveCard: (id: string) => void;
  onFinish: () => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.onboardingCard}>
        <Text style={styles.heroCaption}>ONBOARDING</Text>
        <Text style={styles.onboardingTitle}>Set up your wallet</Text>
        <Text style={styles.onboardingCopy}>
          Add the bank accounts and credit cards you want available when logging
          expenses. You can skip any section.
        </Text>

        <View style={styles.onboardingModeCard}>
          <Text style={styles.listTitle}>Bank names</Text>
          <Text style={styles.listMeta}>Used for UPI and direct bank payments.</Text>
          {upiBanks.length > 0 ? (
            <View style={styles.bankBubbleWrap}>
              {upiBanks.map((bank) => (
                <Pressable
                  key={bank.id}
                  style={styles.bankBubbleStatic}
                  onPress={() => onRemoveUpiBank(bank.id)}
                >
                  <Text style={styles.bankBubbleText}>{bank.label}  ✕</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.helperText}>No banks added yet.</Text>
          )}
          <View style={styles.addRow}>
            <TextInput
              value={newUpiBankName}
              onChangeText={onChangeNewUpiBank}
              placeholder="e.g. HDFC, ICICI"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.addChipInput]}
              onSubmitEditing={onAddUpiBank}
              returnKeyType="done"
            />
            <Pressable
              style={({ pressed }) => [
                styles.inlineButton,
                styles.addButton,
                pressed && styles.pressed
              ]}
              onPress={onAddUpiBank}
            >
              <Text style={styles.primaryButtonText}>+ Add bank</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.onboardingModeCard}>
          <Text style={styles.listTitle}>Credit cards</Text>
          <Text style={styles.listMeta}>Tap a chip to remove it.</Text>
          {cardNames.length > 0 ? (
            <View style={styles.bankBubbleWrap}>
              {cardNames.map((card) => (
                <Pressable
                  key={card.id}
                  style={styles.bankBubbleStatic}
                  onPress={() => onRemoveCard(card.id)}
                >
                  <Text style={styles.bankBubbleText}>{card.label}  ✕</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={styles.helperText}>No cards added yet.</Text>
          )}
          <View style={styles.addRow}>
            <TextInput
              value={newCardName}
              onChangeText={onChangeNewCard}
              placeholder="e.g. HDFC Millennia"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.addChipInput]}
              onSubmitEditing={onAddCard}
              returnKeyType="done"
            />
            <Pressable
              style={({ pressed }) => [
                styles.inlineButton,
                styles.addButton,
                pressed && styles.pressed
              ]}
              onPress={onAddCard}
            >
              <Text style={styles.primaryButtonText}>+ Add card</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={onFinish}
        >
          <Text style={styles.primaryButtonText}>Continue to app</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function RecentList({
  expenses,
  onDelete,
  onEdit
}: {
  expenses: Expense[];
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  if (expenses.length === 0) {
    return (
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Recent</Text>
        <Text style={styles.helperText}>
          No expenses yet. Use the voice or manual form above to add one.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Recent</Text>
      <Text style={styles.helperText}>Tap any transaction to edit it.</Text>
      {expenses.slice(0, 8).map((expense) => (
        <TransactionRow
          key={expense.id}
          expense={expense}
          onPress={() => onEdit(expense.id)}
          onDelete={() => onDelete(expense.id)}
          showDate={false}
        />
      ))}
    </View>
  );
}

function TransactionRow({
  expense,
  onPress,
  onDelete,
  showDate
}: {
  expense: Expense;
  onPress?: () => void;
  onDelete?: () => void;
  showDate?: boolean;
}) {
  const label = getDisplayLabel(expense);
  const initial = label.charAt(0).toUpperCase() || "M";
  const secondaryLine = [
    formatTimeFriendly(expense.time),
    expense.paymentSource || expense.paymentMode
  ]
    .filter(Boolean)
    .join(" • ");
  const subMetaLine = [
    showDate ? formatDateFriendly(expense.date) : null,
    expense.merchant && expense.category ? expense.category : null
  ]
    .filter(Boolean)
    .join(" • ");

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ppRow, pressed && styles.ppRowPressed]}
    >
      <View style={styles.ppAvatar}>
        <Text style={styles.ppAvatarText}>{initial}</Text>
      </View>
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text style={styles.ppTitle} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.ppMeta} numberOfLines={1}>
          {secondaryLine}
        </Text>
        {subMetaLine ? (
          <Text style={styles.ppSubMeta} numberOfLines={1}>
            {subMetaLine}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.ppAmount}>- {formatCurrency(expense.amount)}</Text>
        {onDelete ? (
          <Pressable
            onPress={(event) => {
              event.stopPropagation?.();
              onDelete();
            }}
            style={styles.deleteButton}
            hitSlop={6}
          >
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const formatCompactAmount = (amount: number) => {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(1)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
  if (amount >= 10000) return `₹${Math.round(amount / 1000)}k`;
  if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}k`;
  return `₹${Math.round(amount)}`;
};

function CalendarHeatmap({
  expenses,
  onEditExpense
}: {
  expenses: Expense[];
  onEditExpense: (id: string) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [mode, setMode] = useState<"grid" | "month">("grid");

  const monthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric"
  });
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();

  const isCurrentMonth =
    viewYear === today.getFullYear() && viewMonth === today.getMonth();
  const todayDate = today.getDate();

  const totals = new Map<number, number>();
  const counts = new Map<number, number>();

  expenses.forEach((expense) => {
    if (!expense.date.startsWith(monthKey)) return;
    const day = Number(expense.date.slice(-2));
    if (!Number.isNaN(day)) {
      totals.set(day, (totals.get(day) ?? 0) + expense.amount);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  });
  const allTotals = Array.from(totals.values());
  const max = allTotals.length > 0 ? Math.max(...allTotals, 1) : 1;
  const monthTotal = allTotals.reduce((sum, value) => sum + value, 0);
  const selectedTotal = selectedDay ? totals.get(selectedDay) ?? 0 : 0;
  const selectedCount = selectedDay ? counts.get(selectedDay) ?? 0 : 0;

  const selectedDateIso = selectedDay
    ? `${monthKey}-${String(selectedDay).padStart(2, "0")}`
    : null;
  const dayTransactions = selectedDateIso
    ? getTransactionsForDate(expenses, selectedDateIso)
    : [];
  const monthTransactions = useMemo(
    () => getTransactionsForMonth(expenses, monthKey),
    [expenses, monthKey]
  );

  // Group month transactions by date
  const monthGroups = useMemo(() => {
    const groups: Array<{ date: string; items: Expense[]; total: number }> = [];
    const byDate = new Map<string, Expense[]>();
    monthTransactions.forEach((expense) => {
      const arr = byDate.get(expense.date) ?? [];
      arr.push(expense);
      byDate.set(expense.date, arr);
    });
    Array.from(byDate.keys())
      .sort((a, b) => b.localeCompare(a))
      .forEach((date) => {
        const items = byDate.get(date) ?? [];
        groups.push({
          date,
          items,
          total: items.reduce((sum, expense) => sum + expense.amount, 0)
        });
      });
    return groups;
  }, [monthTransactions]);

  const goPrev = () => {
    setSelectedDay(null);
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };
  const goNext = () => {
    setSelectedDay(null);
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };
  const goToday = () => {
    setSelectedDay(null);
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  };

  const cells: Array<{ key: string; day: number | null }> = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ key: `empty-${i}`, day: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ key: `day-${d}`, day: d });
  }

  return (
    <View style={styles.sectionCard}>
      <View style={styles.calendarNav}>
        <Pressable
          onPress={goPrev}
          style={({ pressed }) => [styles.navArrow, pressed && styles.pressed]}
          accessibilityLabel="Previous month"
        >
          <Text style={styles.navArrowText}>‹</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setSelectedDay(null);
            setMode((current) => (current === "grid" ? "month" : "grid"));
          }}
          style={({ pressed }) => [
            styles.calendarNavCenter,
            pressed && styles.pressed
          ]}
          accessibilityLabel="Toggle month transactions"
        >
          <Text style={styles.sectionTitle}>{monthLabel}</Text>
          <Text style={styles.sectionLegend}>
            {monthTotal > 0
              ? `${formatCurrency(monthTotal)} spent`
              : "No expenses this month"}
          </Text>
          <Text style={styles.calendarModeHint}>
            {mode === "grid"
              ? "Tap to see full month list ▾"
              : "Tap to see calendar grid ▴"}
          </Text>
        </Pressable>
        <Pressable
          onPress={goNext}
          style={({ pressed }) => [styles.navArrow, pressed && styles.pressed]}
          accessibilityLabel="Next month"
        >
          <Text style={styles.navArrowText}>›</Text>
        </Pressable>
      </View>

      {!isCurrentMonth ? (
        <Pressable
          onPress={goToday}
          style={({ pressed }) => [styles.todayChip, pressed && styles.pressed]}
        >
          <Text style={styles.todayChipText}>Jump to today</Text>
        </Pressable>
      ) : null}

      <View style={styles.modeToggle}>
        <Pressable
          onPress={() => setMode("grid")}
          style={[
            styles.modeToggleButton,
            mode === "grid" && styles.modeToggleButtonActive
          ]}
        >
          <Text
            style={[
              styles.modeToggleText,
              mode === "grid" && styles.modeToggleTextActive
            ]}
          >
            Calendar
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setSelectedDay(null);
            setMode("month");
          }}
          style={[
            styles.modeToggleButton,
            mode === "month" && styles.modeToggleButtonActive
          ]}
        >
          <Text
            style={[
              styles.modeToggleText,
              mode === "month" && styles.modeToggleTextActive
            ]}
          >
            All month
          </Text>
        </Pressable>
      </View>

      {mode === "grid" ? (
        <>
          <Text style={styles.hoverSummary}>
            {selectedDay
              ? `${monthLabel.split(" ")[0]} ${selectedDay}: ${formatCurrency(
                  selectedTotal
                )} across ${selectedCount} expense${
                  selectedCount === 1 ? "" : "s"
                }`
              : "Tap a day to view its transactions. Amount shown on each day like a flight calendar."}
          </Text>

          <View style={styles.weekHeader}>
            {["S", "M", "T", "W", "T", "F", "S"].map((item, idx) => (
              <Text key={`${item}-${idx}`} style={styles.weekLabel}>
                {item}
              </Text>
            ))}
          </View>
          <View style={styles.calendarGrid}>
            {cells.map(({ key, day }) => {
              if (day === null) {
                return (
                  <View key={key} style={[styles.dayCell, styles.dayCellEmpty]} />
                );
              }
              const spend = totals.get(day) ?? 0;
              const intensity = spend === 0 ? 0 : Math.ceil((spend / max) * 4);
              const bg = HEAT_COLORS[intensity];
              const isSelected = selectedDay === day;
              const isToday = isCurrentMonth && day === todayDate;
              return (
                <Pressable
                  key={key}
                  onPress={() => setSelectedDay(isSelected ? null : day)}
                  style={[
                    styles.dayCell,
                    { backgroundColor: bg },
                    isToday && styles.dayCellToday,
                    isSelected && styles.dayCellSelected
                  ]}
                >
                  <Text
                    style={[
                      styles.dayLabel,
                      intensity === 0 && styles.dayLabelEmpty,
                      isToday && styles.dayLabelToday
                    ]}
                  >
                    {day}
                  </Text>
                  {spend > 0 ? (
                    <Text
                      style={[
                        styles.dayAmount,
                        intensity >= 3 && styles.dayAmountBright
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {formatCompactAmount(spend)}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.legendRow}>
            <Text style={styles.legendLabel}>Less</Text>
            <View
              style={[styles.legendCell, { backgroundColor: HEAT_COLORS[0] }]}
            />
            <View
              style={[styles.legendCell, { backgroundColor: HEAT_COLORS[1] }]}
            />
            <View
              style={[styles.legendCell, { backgroundColor: HEAT_COLORS[2] }]}
            />
            <View
              style={[styles.legendCell, { backgroundColor: HEAT_COLORS[3] }]}
            />
            <View
              style={[styles.legendCell, { backgroundColor: HEAT_COLORS[4] }]}
            />
            <Text style={styles.legendLabel}>More</Text>
          </View>

          {selectedDateIso ? (
            <View style={styles.dayDetail}>
              <View style={styles.dayDetailHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.dayDetailTitle}>
                    {formatDateFriendly(selectedDateIso)}
                  </Text>
                  <Text style={styles.dayDetailMeta}>
                    {selectedCount > 0
                      ? `${formatCurrency(
                          selectedTotal
                        )} • ${selectedCount} transaction${
                          selectedCount === 1 ? "" : "s"
                        }`
                      : "No transactions"}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setSelectedDay(null)}
                  style={({ pressed }) => [
                    styles.outlineButton,
                    styles.dayDetailClose,
                    pressed && styles.pressed
                  ]}
                >
                  <Text style={styles.outlineButtonText}>Close</Text>
                </Pressable>
              </View>
              {dayTransactions.length === 0 ? (
                <Text style={styles.helperText}>
                  Nothing logged on this day yet. Add one from the quick-add
                  above.
                </Text>
              ) : (
                <>
                  <Text style={styles.helperText}>Tap a row to edit.</Text>
                  {dayTransactions.map((expense) => (
                    <TransactionRow
                      key={expense.id}
                      expense={expense}
                      onPress={() => onEditExpense(expense.id)}
                      showDate={false}
                    />
                  ))}
                </>
              )}
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.monthList}>
          {monthGroups.length === 0 ? (
            <Text style={styles.helperText}>
              No transactions for {monthLabel}. Add one from the quick-add
              above.
            </Text>
          ) : (
            <>
              <Text style={styles.helperText}>Tap a row to edit.</Text>
              {monthGroups.map((group) => (
                <View key={group.date} style={styles.monthGroup}>
                  <View style={styles.monthGroupHeader}>
                    <Text style={styles.monthGroupDate}>
                      {formatDateFriendly(group.date)}
                    </Text>
                    <Text style={styles.monthGroupTotal}>
                      {formatCurrency(group.total)}
                    </Text>
                  </View>
                  {group.items.map((expense) => (
                    <TransactionRow
                      key={expense.id}
                      expense={expense}
                      onPress={() => onEditExpense(expense.id)}
                      showDate={false}
                    />
                  ))}
                </View>
              ))}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const HEAT_COLORS = [
  "#15152a", // 0 - empty (matches panel, subtle)
  "#1f2547", // 1
  "#2e3a7a", // 2
  "#4756c2", // 3
  "#6f7fff"  // 4 (accent glow)
];

function HistoryScreen({
  expenses,
  onEdit
}: {
  expenses: Expense[];
  onEdit: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const byDate = new Map<string, Expense[]>();
    expenses.forEach((expense) => {
      const current = byDate.get(expense.date) ?? [];
      current.push(expense);
      byDate.set(expense.date, current);
    });
    return Array.from(byDate.entries())
      .map(([date, items]) => ({
        date,
        items: items.slice().sort((a, b) => (b.time ?? "").localeCompare(a.time ?? "")),
        total: items.reduce((sum, item) => sum + item.amount, 0)
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses]);

  const todayIso = getCurrentExpenseStamp().date;
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayIso = `${yesterday.getFullYear()}-${String(
    yesterday.getMonth() + 1
  ).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  const getHistoryHeader = (date: string) => {
    if (date === todayIso) return "Today";
    if (date === yesterdayIso) return "Yesterday";
    return formatDateFriendly(date);
  };

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>History</Text>
      {expenses.length === 0 ? (
        <Text style={styles.helperText}>No transactions yet.</Text>
      ) : (
        <View style={styles.historyList}>
          <Text style={styles.helperText}>Tap any transaction to edit it.</Text>
          {groups.map((group) => (
            <View key={group.date} style={styles.historyDayGroup}>
              <View style={styles.historyDayHeader}>
                <Text style={styles.historyDayTitle}>{getHistoryHeader(group.date)}</Text>
                <Text style={styles.historyDayTotal}>
                  {formatCurrency(group.total)}
                </Text>
              </View>
              {group.items.map((expense) => (
                <TransactionRow
                  key={expense.id}
                  expense={expense}
                  onPress={() => onEdit(expense.id)}
                  showDate={false}
                />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function EditExpenseModal({
  expense,
  profile,
  availableCategories,
  onClose,
  onSave,
  onDelete
}: {
  expense: Expense | null;
  profile: PaymentProfile;
  availableCategories: Category[];
  onClose: () => void;
  onSave: (patch: Partial<Expense>) => void;
  onDelete: (id: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("UPI");
  const [paymentSource, setPaymentSource] = useState("");
  const [comment, setComment] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  const loadedId = expense?.id ?? null;
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  if (expense && hydratedFor !== loadedId) {
    setAmount(String(expense.amount ?? ""));
    setMerchant(expense.merchant ?? "");
    setCategory(expense.category ?? "");
    setPaymentMode(expense.paymentMode);
    setPaymentSource(expense.paymentSource ?? "");
    setComment(expense.comment ?? "");
    setDate(expense.date);
    setTime(expense.time);
    setHydratedFor(loadedId);
  }
  if (!expense && hydratedFor !== null) {
    setHydratedFor(null);
  }

  const sourcesForMode = expense
    ? getPaymentSources(profile, paymentMode)
    : [];

  const handleSave = () => {
    onSave({
      amount: Number(amount) || 0,
      merchant: merchant.trim(),
      category: category.trim(),
      paymentMode,
      paymentSource: paymentSource || paymentMode,
      comment,
      date,
      time
    });
  };

  return (
    <Modal
      visible={expense !== null}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView
            contentContainerStyle={{ padding: spacing.md }}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.modalHeader}>
              <Text style={styles.sectionTitle}>Edit transaction</Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.navArrow,
                  pressed && styles.pressed
                ]}
                hitSlop={8}
              >
                <Text style={styles.navArrowText}>×</Text>
              </Pressable>
            </View>
            <Text style={styles.manualMeta}>
              Edit any field. Leave merchant or category blank to keep it as
              Miscellaneous.
            </Text>

            <View style={styles.amountRow}>
              <Text style={styles.currencyMark}>₹</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                style={styles.amountInput}
              />
            </View>

            <View style={styles.sectionShell}>
              <Text style={styles.fieldLabel}>MERCHANT (OPTIONAL)</Text>
              <TextInput
                value={merchant}
                onChangeText={setMerchant}
                placeholder="Leave blank for Miscellaneous"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.inlineFieldInput]}
              />
            </View>

            <View style={styles.sectionShell}>
              <Text style={styles.fieldLabel}>CATEGORY (OPTIONAL)</Text>
              <View style={styles.categoryRow}>
                {availableCategories.map((item) => (
                  <Pressable
                    key={item}
                    onPress={() =>
                      setCategory((current) => (current === item ? "" : item))
                    }
                    style={[
                      styles.categoryPill,
                      category === item && styles.categoryPillActive
                    ]}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        category === item && styles.categoryTextActive
                      ]}
                    >
                      {item}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={category}
                onChangeText={setCategory}
                placeholder="Or type any category"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.inlineFieldInput, { marginTop: spacing.sm }]}
              />
            </View>

            <View style={styles.sectionShell}>
              <Text style={styles.fieldLabel}>PAYMENT MODE</Text>
              <View style={styles.categoryRow}>
                {paymentModes.map((mode) => (
                  <Pressable
                    key={mode}
                    onPress={() => {
                      setPaymentMode(mode);
                      const next = getPaymentSources(profile, mode)[0];
                      setPaymentSource(
                        next
                          ? next.accountLabel
                            ? `${next.label} • ${next.accountLabel}`
                            : next.label
                          : mode
                      );
                    }}
                    style={[
                      styles.categoryPill,
                      paymentMode === mode && styles.categoryPillActive
                    ]}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        paymentMode === mode && styles.categoryTextActive
                      ]}
                    >
                      {mode}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {sourcesForMode.length > 0 ? (
              <View style={styles.sectionShell}>
                <Text style={styles.fieldLabel}>PAYMENT SOURCE</Text>
                <View style={styles.categoryRow}>
                  {sourcesForMode.map((source) => {
                    const formatted = source.accountLabel
                      ? `${source.label} • ${source.accountLabel}`
                      : source.label;
                    return (
                      <Pressable
                        key={source.id}
                        onPress={() => setPaymentSource(formatted)}
                        style={[
                          styles.categoryPill,
                          paymentSource === formatted && styles.categoryPillActive
                        ]}
                      >
                        <Text
                          style={[
                            styles.categoryText,
                            paymentSource === formatted && styles.categoryTextActive
                          ]}
                        >
                          {formatted}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            <View style={styles.sectionShell}>
              <Text style={styles.fieldLabel}>DATE</Text>
              <TextInput
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.inlineFieldInput]}
              />
            </View>

            <View style={styles.sectionShell}>
              <Text style={styles.fieldLabel}>TIME</Text>
              <TextInput
                value={time}
                onChangeText={setTime}
                placeholder="HH:MM (24h)"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.inlineFieldInput]}
              />
            </View>

            <View style={styles.sectionShell}>
              <Text style={styles.fieldLabel}>COMMENT</Text>
              <TextInput
                value={comment}
                onChangeText={setComment}
                placeholder="Optional note"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.inlineFieldInput]}
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed
              ]}
              onPress={handleSave}
            >
              <Text style={styles.primaryButtonText}>Save changes</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.outlineButton,
                { marginTop: spacing.sm },
                pressed && styles.pressed
              ]}
              onPress={() => expense && onDelete(expense.id)}
            >
              <Text style={[styles.outlineButtonText, { color: colors.danger }]}>
                Delete transaction
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.outlineButton,
                { marginTop: spacing.sm },
                pressed && styles.pressed
              ]}
              onPress={onClose}
            >
              <Text style={styles.outlineButtonText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BudgetsScreen({
  budgetStats,
  categories,
  onUpdate
}: {
  budgetStats: Array<Budget & { spent: number; progress: number }>;
  categories: Category[];
  onUpdate: (category: Category, value: string) => void;
}) {
  // Render every category — start with budgetStats, then any categories not yet
  // in budgets at limit 0
  const rows = categories.map((category) => {
    const found = budgetStats.find((b) => b.category === category);
    return found ?? { category, limit: 0, spent: 0, progress: 0 };
  });

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Category budgets</Text>
      <Text style={styles.helperText}>Set a monthly limit for each category.</Text>
      {rows.map((budget) => (
        <View key={budget.category} style={styles.budgetCard}>
          <View style={styles.budgetHeader}>
            <Text style={styles.listTitle}>{budget.category}</Text>
            <Text style={styles.listMeta}>
              {formatCurrency(budget.spent)} spent
            </Text>
          </View>
          <View style={styles.budgetInputRow}>
            <Text style={styles.currencySmall}>₹</Text>
            <TextInput
              value={budget.limit > 0 ? String(budget.limit) : ""}
              onChangeText={(value) => onUpdate(budget.category, value)}
              placeholder="Set limit"
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
              style={styles.budgetInput}
            />
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(budget.progress * 100, 100)}%` },
                budget.progress >= 1 && { backgroundColor: colors.danger }
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

function InsightsScreen({
  categoryStats,
  monthStats,
  insights
}: {
  categoryStats: Array<{ category: Category; total: number }>;
  monthStats: Array<{ label: string; total: number }>;
  insights: string[];
}) {
  const filteredCategoryStats = categoryStats.filter((item) => item.total > 0);
  const maxCategory = Math.max(...filteredCategoryStats.map((i) => i.total), 1);
  const maxMonth = Math.max(...monthStats.map((i) => i.total), 1);

  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>Insights</Text>
      {insights.map((item) => (
        <Text key={item} style={styles.insightText}>
          {item}
        </Text>
      ))}

      <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>
        Category split
      </Text>
      {filteredCategoryStats.length === 0 ? (
        <Text style={styles.helperText}>No expenses yet to analyze.</Text>
      ) : (
        filteredCategoryStats.map((item) => (
          <View key={item.category} style={styles.chartRow}>
            <Text style={styles.chartLabel} numberOfLines={1}>
              {item.category}
            </Text>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  { width: `${(item.total / maxCategory) * 100}%` }
                ]}
              />
            </View>
            <Text style={styles.chartValue} numberOfLines={1}>
              {formatCurrency(item.total)}
            </Text>
          </View>
        ))
      )}

      <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>
        Monthly trend
      </Text>
      <View style={styles.monthChart}>
        {monthStats.map((item) => (
          <View key={item.label} style={styles.monthBarWrap}>
            <View
              style={[
                styles.monthBar,
                { height: 8 + (item.total / maxMonth) * 100 }
              ]}
            />
            <Text style={styles.weekLabel}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.appBg
  },
  card: {
    backgroundColor: colors.panel,
    borderRadius: 20,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 110,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center"
  },
  pressed: {
    opacity: 0.7
  },
  hero: {
    backgroundColor: colors.panel,
    borderRadius: 24,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#1f1d30"
  },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.md,
    gap: spacing.sm
  },
  heroCaption: {
    color: colors.textMuted,
    fontSize: 12,
    letterSpacing: 1.5
  },
  heroTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "700",
    marginTop: 4
  },
  monthSpentPill: {
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: "flex-end",
    maxWidth: 160
  },
  monthSpentText: {
    color: colors.accentStrong,
    fontSize: 16,
    fontWeight: "800"
  },
  monthSpentSub: {
    color: colors.textMuted,
    fontWeight: "600",
    fontSize: 11,
    marginTop: 2
  },
  entryMethodCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.md
  },
  entryMethodRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  entryMethodButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    paddingVertical: 10,
    alignItems: "center"
  },
  entryMethodButtonActive: {
    backgroundColor: colors.accent
  },
  entryMethodButtonText: {
    color: colors.textMuted,
    fontWeight: "700"
  },
  entryMethodButtonTextActive: {
    color: "#fff"
  },
  voiceHero: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center"
  },
  micButton: {
    marginTop: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.accentDim,
    borderWidth: 2,
    borderColor: colors.accent
  },
  micButtonInner: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    borderRadius: 60
  },
  micButtonRecording: {
    backgroundColor: colors.danger,
    borderColor: "#ff4f5a"
  },
  micIcon: {
    fontSize: 38
  },
  micLabel: {
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4
  },
  voiceStatusBox: {
    alignItems: "center",
    paddingVertical: spacing.lg,
    gap: spacing.sm
  },
  voiceStatusText: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700"
  },
  voiceStatusSub: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20
  },
  voiceDoneIcon: {
    fontSize: 44
  },
  voiceErrorIcon: {
    fontSize: 44
  },
  voiceTranscript: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: "italic",
    textAlign: "center",
    paddingHorizontal: spacing.md,
    lineHeight: 20
  },
  manualSection: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: spacing.md
  },
  manualHeader: {
    marginBottom: 4
  },
  manualTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700"
  },
  manualMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.md
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.panel,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  currencyMark: {
    color: colors.text,
    fontSize: 30,
    marginRight: spacing.sm
  },
  amountInput: {
    flex: 1,
    color: colors.text,
    fontSize: 28,
    paddingVertical: 14,
    paddingLeft: 2,
    minWidth: 0
  },
  sectionShell: {
    backgroundColor: colors.panel,
    borderRadius: 16,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 1.2,
    marginBottom: spacing.sm
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4
  },
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  categoryPill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card
  },
  categoryPillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accentStrong
  },
  categoryText: {
    color: colors.textMuted,
    fontWeight: "600",
    fontSize: 14
  },
  categoryTextActive: {
    color: "#fff"
  },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 16
  },
  inlineFieldInput: {
    marginBottom: 0,
    backgroundColor: colors.card
  },
  voiceInput: {
    minHeight: 100,
    textAlignVertical: "top"
  },
  customCategoryRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "stretch",
    marginTop: spacing.sm
  },
  customCategoryInput: {
    flex: 1,
    marginBottom: 0,
    backgroundColor: colors.card
  },
  outlineButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    backgroundColor: colors.card
  },
  outlineButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700"
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center"
  },
  secondaryButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
    backgroundColor: colors.card
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 16
  },
  inlineButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    justifyContent: "center"
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16
  },
  actionStack: {
    gap: spacing.sm
  },
  segmentRow: {
    flexDirection: "row",
    marginTop: spacing.lg,
    marginBottom: spacing.md
  },
  segmentButton: {
    marginRight: spacing.lg,
    paddingBottom: spacing.sm
  },
  segmentLabel: {
    color: colors.textMuted,
    fontWeight: "600",
    fontSize: 16
  },
  segmentLabelActive: {
    color: colors.accentStrong
  },
  segmentUnderline: {
    height: 3,
    backgroundColor: colors.accent,
    borderRadius: 999,
    marginTop: 8
  },
  sectionCard: {
    backgroundColor: colors.panel,
    borderRadius: 20,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#1f1d30"
  },
  historyList: {
    marginTop: spacing.sm,
    gap: spacing.md
  },
  historyDayGroup: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm
  },
  historyDayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
    marginBottom: spacing.xs
  },
  historyDayTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700"
  },
  historyDayTotal: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700"
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: spacing.sm,
    gap: spacing.sm
  },
  hoverSummary: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.sm,
    lineHeight: 18
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "700"
  },
  sectionLegend: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: spacing.sm
  },
  legendCell: {
    width: 16,
    height: 16,
    borderRadius: 4
  },
  legendLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginHorizontal: 4
  },
  weekHeader: {
    flexDirection: "row",
    marginBottom: spacing.sm
  },
  weekLabel: {
    color: colors.textMuted,
    flex: 1,
    textAlign: "center",
    fontSize: 12
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap"
  },
  calendarNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm
  },
  calendarNavCenter: {
    flex: 1,
    alignItems: "center"
  },
  navArrow: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  navArrowText: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 24
  },
  todayChip: {
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.accent,
    marginBottom: spacing.sm
  },
  todayChipText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
    letterSpacing: 0.5
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 0.82,
    padding: 3,
    borderRadius: 10,
    backgroundColor: HEAT_COLORS[0],
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent"
  },
  dayCellEmpty: {
    backgroundColor: "transparent",
    borderColor: "transparent"
  },
  dayCellSelected: {
    borderColor: "#fff"
  },
  dayCellToday: {
    borderColor: colors.accentStrong
  },
  dayLabel: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
    lineHeight: 15
  },
  dayLabelEmpty: {
    color: colors.textMuted
  },
  dayLabelToday: {
    color: colors.accentStrong
  },
  dayAmount: {
    marginTop: 2,
    color: "#e7e4ff",
    fontWeight: "700",
    fontSize: 10,
    letterSpacing: 0.2
  },
  dayAmountBright: {
    color: "#fff"
  },
  listRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1f1d30",
    gap: spacing.sm
  },
  listTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700"
  },
  listMeta: {
    color: colors.textMuted,
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18
  },
  listSubMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2
  },
  listAmount: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 16
  },
  deleteButton: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  deleteText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: "700"
  },
  voiceTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: spacing.xs
  },
  voiceHint: {
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.md,
    fontSize: 14
  },
  budgetCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border
  },
  budgetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
    gap: spacing.sm
  },
  budgetInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.panel,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border
  },
  currencySmall: {
    color: colors.text,
    fontSize: 16,
    marginRight: 6
  },
  budgetInput: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 10
  },
  progressTrack: {
    height: 8,
    backgroundColor: colors.cardMuted,
    borderRadius: 999,
    overflow: "hidden"
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.accent
  },
  insightText: {
    color: colors.text,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: spacing.md,
    marginTop: spacing.sm,
    lineHeight: 20,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border
  },
  chartRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm
  },
  chartLabel: {
    color: colors.text,
    width: 80,
    fontSize: 13
  },
  barTrack: {
    flex: 1,
    height: 10,
    backgroundColor: colors.cardMuted,
    borderRadius: 999,
    overflow: "hidden"
  },
  barFill: {
    height: "100%",
    backgroundColor: colors.accentStrong
  },
  chartValue: {
    color: colors.textMuted,
    width: 80,
    textAlign: "right",
    fontSize: 12
  },
  monthChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: spacing.md,
    height: 140
  },
  monthBarWrap: {
    alignItems: "center",
    flex: 1
  },
  monthBar: {
    width: 18,
    borderRadius: 999,
    backgroundColor: colors.accent,
    marginBottom: spacing.sm
  },
  bottomNav: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: colors.panel,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#1f1d30",
    paddingVertical: spacing.sm,
    maxWidth: 520,
    alignSelf: "center"
  },
  navItem: {
    paddingVertical: 10,
    paddingHorizontal: 6,
    flex: 1,
    alignItems: "center"
  },
  navLabel: {
    color: colors.textMuted,
    fontWeight: "600",
    fontSize: 13
  },
  navLabelActive: {
    color: colors.accentStrong
  },
  onboardingCard: {
    backgroundColor: colors.panel,
    borderRadius: 24,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#2a2840"
  },
  onboardingTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    marginTop: spacing.sm
  },
  onboardingCopy: {
    color: colors.textMuted,
    lineHeight: 22,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    fontSize: 15
  },
  onboardingModeCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border
  },
  bankBubbleWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm
  },
  bankBubbleStatic: {
    backgroundColor: colors.panel,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border
  },
  bankBubbleText: {
    color: colors.text,
    fontWeight: "700",
    fontSize: 13
  },
  addRow: {
    flexDirection: "column",
    gap: spacing.sm,
    alignItems: "stretch",
    marginTop: spacing.md
  },
  addChipInput: {
    marginBottom: 0,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 16
  },
  addButton: {
    width: "100%",
    alignItems: "center"
  },
  calendarModeHint: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
    letterSpacing: 0.6
  },
  modeToggle: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: 999,
    padding: 4,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border
  },
  modeToggleButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 999
  },
  modeToggleButtonActive: {
    backgroundColor: colors.accent
  },
  modeToggleText: {
    color: colors.textMuted,
    fontWeight: "700",
    fontSize: 13
  },
  modeToggleTextActive: {
    color: "#fff"
  },
  ppRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#1f1d30",
    gap: spacing.sm
  },
  ppRowPressed: {
    opacity: 0.6
  },
  ppAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentDim
  },
  ppAvatarText: {
    color: "#fff",
    fontWeight: "800",
    fontSize: 16
  },
  ppTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  ppMeta: {
    color: colors.textMuted,
    marginTop: 2,
    fontSize: 12
  },
  ppSubMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2
  },
  ppAmount: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 15
  },
  dayDetail: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  dayDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm
  },
  dayDetailTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800"
  },
  dayDetailMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2
  },
  dayDetailClose: {
    paddingVertical: 8,
    paddingHorizontal: 14
  },
  monthList: {
    marginTop: spacing.sm
  },
  monthGroup: {
    marginTop: spacing.md
  },
  monthGroupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 4
  },
  monthGroupDate: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.3
  },
  monthGroupTotal: {
    color: colors.accentStrong,
    fontWeight: "800",
    fontSize: 13
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(5, 5, 12, 0.7)",
    justifyContent: "flex-end"
  },
  modalCard: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "92%",
    borderWidth: 1,
    borderColor: colors.border
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm
  }
});
