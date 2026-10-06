import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../../src/app/globals.css";
import "../../src/app/meal.css";
import "../../src/app/nutrition.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/fit-chef";

export const viewport: Viewport = { themeColor: "#365c3c" };

export const metadata: Metadata = {
  title: "FIT Diario | Calorie, macros e il tuo obiettivo",
  description: "Diario alimentare, TDEE e macros personalizzati. Dati privati sincronizzati con Google, senza servizi AI a pagamento.",
  manifest: `${basePath}/manifest.webmanifest`,
  icons: { icon: `${basePath}/icon.svg` },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="it">
      <body><a className="skip-link" href="#main-content">Vai al contenuto</a>{children}</body>
    </html>
  );
}
