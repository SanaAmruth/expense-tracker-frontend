export type PaymentMode = "Cash" | "UPI" | "Card" | "Bank" | "";

export type Category = string;

export type PaymentInstrument = {
  id: string;
  label: string;
  accountLabel?: string;
};

export type PaymentProfile = {
  cashEnabled: boolean;
  upiAccounts: PaymentInstrument[];
  cards: PaymentInstrument[];
  bankAccounts: PaymentInstrument[];
};

export type Expense = {
  id: string;
  amount: number;
  merchant: string;
  date: string;
  time: string;
  paymentMode: PaymentMode;
  paymentSource: string;
  category: Category;
  comment: string;
};

export type Budget = {
  category: Category;
  limit: number;
};
