import Link from "next/link";

import { OnboardingGuide } from "@/components/OnboardingGuide";
import { PlanningWorkspace } from "@/components/PlanningWorkspace";
import styles from "./page.module.css";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ step?: string | string[] | undefined }>;
}) {
  const { step } = await searchParams;
  const initialDocumentSubstep = step === "graduation-requirements"
    ? "graduation_requirements"
    : undefined;

  return (
    <main className={styles.page}>
      <OnboardingGuide />
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <h1>SKKU-DULE</h1>
          <Link className={styles.friendsButton} href="/friends">
            내 시간표 · 친구 시간표 보기
          </Link>
        </div>
      </section>
      <PlanningWorkspace initialDocumentSubstep={initialDocumentSubstep} />
      <footer className={styles.footer}>
        <p>
          오류 제보·문의: <a href="mailto:jaeseong.hong@gmail.com">jaeseong.hong@gmail.com</a>
        </p>
      </footer>
    </main>
  );
}
