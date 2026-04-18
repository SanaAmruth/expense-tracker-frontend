import { Budget, Category, Expense, PaymentMode, PaymentProfile } from "./types";

export const categories: Category[] = [
  "Groceries",
  "Food",
  "Transport",
  "Health",
  "Shopping",
  "Bills"
];

export const paymentModes: PaymentMode[] = ["Cash", "UPI", "Card", "Bank"];

export const defaultPaymentProfile: PaymentProfile = {
  cashEnabled: true,
  upiAccounts: [],
  cards: [],
  bankAccounts: []
};

export const defaultBudgets: Budget[] = [];

export const initialExpenses: Expense[] = [];
