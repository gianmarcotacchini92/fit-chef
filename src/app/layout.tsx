import type { Metadata } from "next";
import "./globals.css";
import "./meal.css";

export const metadata: Metadata = {
  title: "FIT Chef | Il tuo pasto. Tutto un altro sapore.",
  description: "Scegli giorno e pasto dalla tua dieta settimanale e crea una ricetta gustosa: grammature fisse, alternative esplicite, extra confermati e macros trasparenti.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it">
      <body><a className="skip-link" href="#main-content">Vai al contenuto</a>{children}</body>
    </html>
  );
}
