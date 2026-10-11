import { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose(): void;
  onConfirm(): void;
  error: string;
}

export function ResetDialog({ open, onClose, onConfirm, error }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="reset-dialog"
      aria-labelledby="reset-title"
      aria-describedby="reset-description"
      onCancel={onClose}
    >
      <p className="eyebrow">START AGAIN</p>
      <h2 id="reset-title">처음부터 다시 시작할까요?</h2>
      <p id="reset-description">
        이 브라우저에 저장된 프로젝트, 입력 내용과 진행 기록을 삭제해요. 삭제한
        내용은 복구할 수 없어요.
      </p>
      <p className="field-error" role="alert">
        {error && error.includes("초기화하지") ? error : ""}
      </p>
      <div className="dialog-actions">
        <button className="text-button" autoFocus onClick={onClose}>
          취소
        </button>
        <button className="small-button" onClick={onConfirm}>
          초기화하기
        </button>
      </div>
    </dialog>
  );
}
