import { jobIconUrl } from "@/ui/services/icons";
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
      <img
        className={styles.icon}
        src={jobIconUrl(jobId)}
        alt={jobId}
        aria-hidden="true"
      />
      <span className={styles.jobName}>{jobSchemas[jobId].name}</span>
    </Button>
  );
}
