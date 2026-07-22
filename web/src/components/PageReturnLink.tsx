import Link from "next/link";

import styles from "./PageReturnLink.module.css";

export function PageReturnLink({
  href,
  label,
  tone = "light",
  width = "wide",
}: {
  href: string;
  label: string;
  tone?: "light" | "dark";
  width?: "wide" | "compact";
}) {
  return (
    <nav
      aria-label="이전 화면으로 이동"
      className={`${styles.navigation} ${width === "compact" ? styles.compact : styles.wide}`}
    >
      <Link className={`${styles.link} ${tone === "dark" ? styles.dark : styles.light}`} href={href}>
        <span aria-hidden="true" className={styles.arrow}>←</span>
        {label}
      </Link>
    </nav>
  );
}
