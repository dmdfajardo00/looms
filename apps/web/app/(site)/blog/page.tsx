import type { Metadata } from "next";
import { UpdatesPage } from "@/components/pages/UpdatesPage";

export const metadata: Metadata = {
	title: "Blog — Looms",
};

export default function App() {
	return <UpdatesPage />;
}
