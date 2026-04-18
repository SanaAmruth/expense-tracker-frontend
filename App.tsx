import { StatusBar } from "expo-status-bar";
import { SafeAreaView, View, Text, TextInput, Pressable } from "react-native";
import { useState } from "react";
import { ExpenseTrackerApp } from "./src/ExpenseTrackerApp";
import { colors } from "./src/theme";

const PASSWORD = "sanatheking";

export default function App() {
  const [entered, setEntered] = useState(false);
  const [input, setInput] = useState("");

  if (!entered) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.appBg, justifyContent: "center", alignItems: "center" }}>
        <StatusBar style="light" />
        <View style={{ width: 300, backgroundColor: colors.card, borderRadius: 18, padding: 28, alignItems: "center", shadowColor: colors.accent, shadowOpacity: 0.12, shadowRadius: 8 }}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "700", marginBottom: 18 }}>Enter Password</Text>
          <TextInput
            secureTextEntry
            value={input}
            onChangeText={setInput}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 14, width: "100%", marginBottom: 18, backgroundColor: colors.panel, fontSize: 16 }}
            autoFocus
            onSubmitEditing={() => { if (input === PASSWORD) setEntered(true); }}
          />
          <Pressable
            onPress={() => { if (input === PASSWORD) setEntered(true); }}
            style={{ backgroundColor: colors.accent, paddingVertical: 12, paddingHorizontal: 32, borderRadius: 8 }}
          >
            <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 16 }}>Unlock</Text>
          </Pressable>
          {input !== "" && input !== PASSWORD && (
            <Text style={{ color: colors.danger, marginTop: 12, fontSize: 14 }}>Incorrect password</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.appBg }}>
      <StatusBar style="light" />
      <ExpenseTrackerApp />
    </SafeAreaView>
  );
}
