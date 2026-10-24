import { GameIcon } from "@/ui/components/game-icon/GameIcon";
import { jobSchemas, type JobId } from "@/domain";
import styles from "./JobButton.module.scss";
import { Button } from "@base-ui/react/button";
import { useState } from "react";

export function JobButton({
  jobId,
  selected,
  disabled,
  onClick,
}: {
  jobId: JobId;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      className={`${styles.container} ${selected ? styles.selected : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <GameIcon jobId={jobId} className={styles.icon} />
      <span className={styles.jobName}>{jobSchemas[jobId].name}</span>
    </Button>
  );
}
