import { PlanningWorkspace } from "@/components/PlanningWorkspace";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <h1>SKKU TIMETABLE</h1>
      </section>
      <PlanningWorkspace />
    </main>
  );
}
