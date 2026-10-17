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
type Confirmation = { title: string; description: string };
type Feedback = {
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
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const advancedTrigger = useRef<HTMLElement | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const resolve = useRef<((value: boolean) => void) | undefined>(undefined);
  useEffect(() => () => resolve.current?.(false), []);
  function finish(value: boolean) {
    resolve.current?.(value);
    resolve.current = undefined;
    setConfirmation(undefined);
  }
  return (
    <Context.Provider
      value={{
        openAdvancedSettings: () => {
          advancedTrigger.current =
            document.activeElement as HTMLElement | null;
          setAdvancedSettingsOpen(true);
        },
        notify: (message, type = "info") => {
          manager.add({ title: message, type });
        },
        confirm: (options) => {
          resolve.current?.(false);
          setConfirmation(options);
          return new Promise<boolean>((done) => {
            resolve.current = done;
          });
        },
      }}
    >
      {children}
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
          if (!open) finish(false);
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
              <button onClick={() => finish(false)}>取消</button>
              <button onClick={() => finish(true)}>确认</button>
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
