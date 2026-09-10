import type { FirebaseOptions } from "firebase/app";

export const firebaseOptions: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyBeQirfiLlK0s8fHhwBmireNfgmoDrC494",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "sincro-ai.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "sincro-ai",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "sincro-ai.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "191255135738",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:191255135738:web:f35524200d045751e15043",
};
