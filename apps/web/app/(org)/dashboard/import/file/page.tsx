import type { Metadata } from "next";
import { ImportFilePage } from "./ImportFilePage";

export const metadata: Metadata = {
	title: "Upload File — Caps",
};

export default function Page() {
	return <ImportFilePage />;
}
