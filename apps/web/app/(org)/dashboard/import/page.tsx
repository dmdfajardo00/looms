import type { Metadata } from "next";
import { ImportPage } from "./ImportPage";

export const metadata: Metadata = {
	title: "Import — Caps",
};

export default function Page() {
	return <ImportPage />;
}
