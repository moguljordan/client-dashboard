// /lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBbw6AQXlo1bTWoSP4x0FUqpbPHt8Xcv8M",
  authDomain: "mda-database.firebaseapp.com",
  projectId: "mda-database",
  storageBucket: "mda-database.appspot.com",
  messagingSenderId: "289133861766",
  appId: "1:289133861766:web:b504683d404f153e382a07",
  measurementId: "G-PH60BGBS9C"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
