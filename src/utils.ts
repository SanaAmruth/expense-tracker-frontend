import { categories } from "./data";
import {
  Budget,
  Category,
  Expense,
  PaymentInstrument,
  PaymentMode,
  PaymentProfile
} from "./types";

const toTitleCase = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

export const getCurrentExpenseStamp = () => {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(now.getDate()).padStart(2, "0")}`;
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;

  return { date, time };
};

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value);

export const getMonthTotal = (expenses: Expense[], isoMonth: string) =>
  expenses
    .filter((expense) => expense.date.startsWith(isoMonth))
    .reduce((sum, expense) => sum + expense.amount, 0);

export const groupByCategory = (expenses: Expense[]) => {
  const allCategories = Array.from(
    new Set([...categories, ...expenses.map((expense) => expense.category)])
  );

  return allCategories.map((category) => ({
    category,
    total: expenses
      .filter((expense) => expense.category === category)
      .reduce((sum, expense) => sum + expense.amount, 0)
  }));
};

export const groupByMonth = (expenses: Expense[]) => {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  return months.map((label, index) => {
    const monthNumber = String(index + 1).padStart(2, "0");
    const total = expenses
      .filter((expense) => expense.date.slice(5, 7) === monthNumber)
      .reduce((sum, expense) => sum + expense.amount, 0);
    return { label, total };
  });
};

export const getBudgetStatus = (expenses: Expense[], budgets: Budget[]) =>
  budgets.map((budget) => {
    const spent = expenses
      .filter((expense) => expense.category === budget.category)
      .reduce((sum, expense) => sum + expense.amount, 0);
    return {
      ...budget,
      spent,
      progress: budget.limit > 0 ? Math.min(spent / budget.limit, 1) : 0
    };
  });

const categoryKeywords: Record<string, string[]> = {
  Groceries: ["grocery", "milk", "vegetable", "supermarket", "blinkit"],
  Food: ["food", "lunch", "dinner", "cafe", "coffee", "zomato", "swiggy"],
  Transport: ["uber", "ola", "metro", "bus", "cab", "fuel"],
  Health: ["doctor", "medicine", "apollo", "clinic", "pharmacy"],
  Shopping: ["amazon", "mall", "shopping", "shirt", "shoe"],
  Bills: ["bill", "electricity", "rent", "internet", "recharge"]
};

const paymentKeywords: Record<PaymentMode, string[]> = {
  UPI: ["upi", "gpay", "phonepe", "paytm", "cred", "bhim"],
  Cash: ["cash"],
  Card: ["card", "credit", "debit", "visa", "mastercard", "amex"],
  Bank: ["bank", "transfer", "neft", "imps", "netbanking"],
  "": []
};

const formatInstrumentLabel = (instrument: PaymentInstrument) =>
  instrument.accountLabel
    ? `${instrument.label} • ${instrument.accountLabel}`
    : instrument.label;

export const getPaymentSources = (
  profile: PaymentProfile,
  mode: PaymentMode
): PaymentInstrument[] => {
  if (mode === "Cash") {
    return profile.cashEnabled ? [{ id: "cash", label: "Cash Wallet" }] : [];
  }
  if (mode === "UPI") {
    return profile.upiAccounts;
  }
  if (mode === "Card") {
    return profile.cards;
  }
  return profile.bankAccounts;
};

export const smartParseExpense = (input: string, profile: PaymentProfile) => {
  const lower = input.toLowerCase();
  const amountMatch = lower.match(/(\d+(?:\.\d+)?)/);
  const amount = amountMatch ? Number(amountMatch[1]) : 0;
  const detectedBaseCategory = categories.find((item) =>
    (categoryKeywords[item] ?? []).some((keyword) => lower.includes(keyword))
  );
  const customCategoryMatch = lower.match(/(?:for|on)\s+([a-z ]{3,30})/);
  const category: Category =
    detectedBaseCategory ??
    toTitleCase(
      (customCategoryMatch?.[1] ?? "Misc")
        .split(" by ")[0]
        .split(" at ")[0]
        .trim()
    );
  const paymentMode =
    (Object.keys(paymentKeywords) as PaymentMode[]).find((mode) =>
      paymentKeywords[mode].some((keyword) => lower.includes(keyword))
    ) ?? "UPI";
  const merchantMatch =
    input.match(/(?:at|from)\s+([A-Za-z][A-Za-z0-9 &'-.]{1,30})/) ??
    input.match(/paid\s+\d+(?:\.\d+)?\s+(?:by\s+\w+\s+)?for\s+(.{2,30})/i);
  const merchant = merchantMatch?.[1]?.trim() || "Voice entry";
  const sources = getPaymentSources(profile, paymentMode);
  const selectedSource =
    sources.find((item) =>
      formatInstrumentLabel(item).toLowerCase().split(" ").some((part) =>
        part && lower.includes(part)
      )
    ) ?? sources[0];

  return {
    amount,
    merchant,
    category,
    paymentMode,
    paymentSource: selectedSource ? formatInstrumentLabel(selectedSource) : paymentMode,
    comment: input
  };
};

export const getDisplayLabel = (expense: Expense): string => {
  const merchant = (expense.merchant ?? "").trim();
  if (merchant) return merchant;
  const category = (expense.category ?? "").trim();
  if (category) return category;
  return "Miscellaneous";
};

export const formatTimeFriendly = (time: string): string => {
  if (!time) return "";
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${suffix}`;
};

export const formatDateFriendly = (dateIso: string): string => {
  const parts = dateIso.split("-").map(Number);
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return dateIso;
  const [y, mo, d] = parts;
  const date = new Date(y, (mo ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
};

export const getTransactionsForDate = (
  expenses: Expense[],
  date: string
): Expense[] =>
  expenses
    .filter((expense) => expense.date === date)
    .slice()
    .sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));

export const getTransactionsForMonth = (
  expenses: Expense[],
  monthKey: string
): Expense[] =>
  expenses
    .filter((expense) => expense.date.startsWith(monthKey))
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.time ?? "").localeCompare(a.time ?? "");
    });

export const buildInsights = (expenses: Expense[]) => {
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const byCategory = groupByCategory(expenses).sort((a, b) => b.total - a.total);
  const topCategory = byCategory[0];
  const avg =
    expenses.length === 0 ? 0 : Math.round(total / Math.max(expenses.length, 1));

  return [
    `This month you have tracked ${formatCurrency(total)} across ${expenses.length} expenses.`,
    `${topCategory?.category ?? "Misc"} is your largest category at ${formatCurrency(
      topCategory?.total ?? 0
    )}.`,
    `Your average transaction is ${formatCurrency(avg)}.`
  ];
};
