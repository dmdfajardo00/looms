import type { Metadata } from "next";
import { FaqPage } from "@/components/pages/FaqPage";

export const metadata: Metadata = {
	title: "FAQ — Caps",
};

export default function App() {
	return <FaqPage />;
}
