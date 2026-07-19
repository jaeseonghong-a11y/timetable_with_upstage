import Link from "next/link";

import { OnboardingGuide } from "@/components/OnboardingGuide";
import { PlanningWorkspace } from "@/components/PlanningWorkspace";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <OnboardingGuide />
      <section className={styles.hero}>
        <h1>SKKU TIMETABLE</h1>
      </section>
      <PlanningWorkspace />
      <footer className={styles.footer}>
        <p>
          <Link href="/friends">친구 시간표 보기</Link>
        </p>
        <p>
          오류 제보·문의: <a href="mailto:jaeseong.hong@gmail.com">jaeseong.hong@gmail.com</a>
        </p>
      </footer>
    </main>
  );
}
