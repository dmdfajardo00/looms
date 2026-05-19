import type { Metadata } from "next";
import { ImportPage } from "./ImportPage";

export const metadata: Metadata = {
	title: "Import — Looms",
};

export default function Page() {
	return <ImportPage />;
}
