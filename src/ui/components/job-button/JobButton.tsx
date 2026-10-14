import { jobSchemas, type JobId } from '@/domain';
import styles from './JobButton.module.scss';
import { Button } from '@base-ui/react/button';
import { useState } from 'react';

export function JobButton(
  {
    jobId,
    selectable = false,
    onClick,
  }: {
    jobId: JobId,
    selectable?: boolean,
    onClick?: () => void,
  }
) {
  const [selected, setSelect] = useState(false);
  return (
    <Button
      className={`${styles.container} ${selectable && selected ? styles.selected : ""}`}
      onClick={() => {
        if (selectable) setSelect(!selected);
        if (onClick) onClick();
      }}
    >
      <img className={styles.icon} src={`/assets/jobs/${jobId}.png`} alt={jobId} />
      <span className={styles.jobName}>{jobSchemas[jobId].name}</span>
    </Button>
  )
}