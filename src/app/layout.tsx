import type { Metadata } from "next";
import "./globals.css";
import "./meal.css";
import "./nutrition.css";

export const metadata: Metadata = {
  title: "FIT Diario | Calorie, macros e il tuo obiettivo",
  description: "Il tuo diario alimentare con profilo TDEE, obiettivi modificabili, barcode e dieta personale sincronizzata con Google. Senza AI a pagamento.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it">
      <body><a className="skip-link" href="#main-content">Vai al contenuto</a>{children}</body>
    </html>
  );
}
