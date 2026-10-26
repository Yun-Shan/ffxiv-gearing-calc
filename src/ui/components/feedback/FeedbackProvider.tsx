import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Toast } from "@base-ui/react/toast";
import styles from "./FeedbackProvider.module.scss";

const feedbackEntries: readonly { name: string; href: string; icon: ReactNode }[] = [
  {
    name: "Github",
    href: "https://github.com/Yun-Shan/ffxiv-gearing-calc/issues/new/choose",
    // GitHub brand icon from Simple Icons (CC0): https://simpleicons.org/?q=github
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    ),
  },
];


type Confirmation = { title: string; description: string; signal?: AbortSignal };
type PendingConfirmation = Confirmation & {
  resolve(value: boolean): void;
  cleanup(): void;
};
type Feedback = {
  openProblemFeedback(): void;
  openAdvancedSettings(): void;
  notify(
    message: string,
    type?: "info" | "warning" | "error" | "success",
  ): void;
  confirm(options: Confirmation): Promise<boolean>;
};
const Context = createContext<Feedback | null>(null);
function FeedbackContent({ children }: { children: ReactNode }) {
  const manager = Toast.useToastManager();
  const [problemFeedbackOpen, setProblemFeedbackOpen] = useState(false);
  const problemFeedbackTrigger = useRef<HTMLElement | null>(null);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const advancedTrigger = useRef<HTMLElement | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>();
  const pending = useRef<PendingConfirmation | undefined>(undefined);
  useEffect(() => () => {
    if (pending.current) finish(false, pending.current, false);
  }, []);
  function finish(value: boolean, request: PendingConfirmation | undefined, update = true) {
    if (!request || pending.current !== request) return;
    pending.current = undefined;
    request.cleanup();
    request.resolve(value);
    if (update) setConfirmation(current => current === request ? undefined : current);
  }
  return (
    <Context.Provider
      value={{
        openProblemFeedback: () => {
          problemFeedbackTrigger.current = document.activeElement as HTMLElement | null;
          setProblemFeedbackOpen(true);
        },
        openAdvancedSettings: () => {
          advancedTrigger.current =
            document.activeElement as HTMLElement | null;
          setAdvancedSettingsOpen(true);
        },
        notify: (message, type = "info") => {
          manager.add({ title: message, type });
        },
        confirm: (options) => {
          if (options.signal?.aborted) return Promise.resolve(false);
          finish(false, pending.current);
          return new Promise<boolean>((done) => {
            const request: PendingConfirmation = {
              ...options,
              resolve: done,
              cleanup: () => options.signal?.removeEventListener("abort", cancel),
            };
            function cancel() { finish(false, request); }
            pending.current = request;
            options.signal?.addEventListener("abort", cancel, { once: true });
            setConfirmation(request);
          });
        },
      }}
    >
      {children}
      <Dialog.Root open={problemFeedbackOpen} onOpenChange={setProblemFeedbackOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup className={styles.dialog} finalFocus={problemFeedbackTrigger}>
            <Dialog.Title className={styles.dialogTitle}>支持与反馈</Dialog.Title>
            <Dialog.Description className={styles.feedbackDescription}>请选择反馈入口。</Dialog.Description>
            <div className={styles.feedbackEntries}>
              {feedbackEntries.map((entry) => (
                <a key={entry.href} className={styles.feedbackCard} href={entry.href} target="_blank" rel="noopener noreferrer">
                  {entry.icon}
                  <span>{entry.name}</span>
                </a>
              ))}
            </div>
            <div className={styles.actions}><Dialog.Close>关闭</Dialog.Close></div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root
        open={advancedSettingsOpen}
        onOpenChange={setAdvancedSettingsOpen}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup className={styles.dialog} finalFocus={advancedTrigger}>
            <Dialog.Title className={styles.dialogTitle}>高级设置</Dialog.Title>
            <Dialog.Description>当前没有可调整的高级设置。</Dialog.Description>
            <div className={styles.actions}>
              <Dialog.Close>关闭</Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Toast.Portal>
        <Toast.Viewport className={styles.toasts}>
          {manager.toasts.map((toast) => (
            <Toast.Root key={toast.id} toast={toast} className={styles.toast}>
              <Toast.Title className={styles.toastTitle} />
              <Toast.Close aria-label="关闭通知">×</Toast.Close>
            </Toast.Root>
          ))}
        </Toast.Viewport>
      </Toast.Portal>
      <Dialog.Root
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open) finish(false, confirmation);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className={styles.backdrop} />
          <Dialog.Popup className={styles.dialog}>
            <Dialog.Title className={styles.dialogTitle}>
              {confirmation?.title}
            </Dialog.Title>
            <Dialog.Description>{confirmation?.description}</Dialog.Description>
            <div className={styles.actions}>
              <button onClick={() => finish(false, confirmation)}>取消</button>
              <button onClick={() => finish(true, confirmation)}>确认</button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </Context.Provider>
  );
}
export function FeedbackProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider>
      <FeedbackContent>{children}</FeedbackContent>
    </Toast.Provider>
  );
}
export function useFeedback(): Feedback {
  const value = useContext(Context);
  if (!value) throw new Error("FeedbackProvider is required");
  return value;
}
