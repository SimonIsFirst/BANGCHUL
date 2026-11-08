import { useEffect, useState } from "react";
import type { CloudRepository } from "../data/cloud-repository";
export interface AccountSession { user: { id: string; displayName: string } | null; available: boolean }
interface Props { session: AccountSession | null; cloud: CloudRepository | null; busy: boolean; error: string; preview: boolean; onOpen(): void; onLocal(): void; onImport(): void; onBackup(): void; onUseServer(): void }
export function AccountControls({ session, cloud, busy, error, preview, onOpen, onLocal, onImport, onBackup, onUseServer }: Props) {
  const [, refresh] = useState(0);
  useEffect(() => cloud?.subscribe(() => refresh((n) => n + 1)), [cloud]);
  const status = cloud?.getStatus();
  return <div className="account-controls">
    {cloud && <span className="cloud-state" data-status={status?.kind} role="status">{status?.kind === "saved" ? "● 서버 저장됨" : status?.kind === "pending" ? "◌ 서버 저장 중" : "! 저장 확인 필요"}</span>}
    <details className="account-menu"><summary>{cloud ? "나의 계정" : "계정에 연결"}<span aria-hidden="true"> ↗</span></summary>
      <div className="account-popover">
        <p className="section-label">PRIVATE CREATIVE SPACE</p><h2>{cloud ? "어디서든, 이어서." : "당신의 작업을 이어가세요."}</h2>
        {preview ? <p>디자인 검토 중에는 계정과 파일 저장을 사용하지 않아요.</p> : !session ? <p>계정 연결 상태를 확인하고 있어요…</p> : !session.available ? <p>계정 저장소 연결을 준비 중이에요. 지금은 이 브라우저에서 작업할 수 있어요.</p> : !session.user ? <>
          <p>로그인하면 다른 기기에서도 작품과 기록을 이어갈 수 있어요. 기존 브라우저 기록은 직접 가져오기를 선택할 때 복사합니다.</p>
          <a className="small-button" href="/signin-with-chatgpt?return_to=%2F%3Faccount%3D1" target="_top">ChatGPT 계정으로 계속하기 ↗</a>
          <p className="account-provider-note">현재 지원 로그인 · ChatGPT<br />구글·카카오 직접 로그인은 아직 연결되지 않았어요.</p>
        </> : <>
          <p className="account-display-name">{session.user.displayName}</p>
          {cloud ? <><p role="status">{status?.message}</p>{status?.kind !== "saved" && <button className="small-button" disabled={busy} onClick={() => { void cloud.flush().catch(() => {}); }}>서버 저장 다시 시도</button>}
            {status?.kind === "error" && <button className="text-button" disabled={busy} onClick={onUseServer}>현재 기록을 보호하고 서버 기록 다시 열기</button>}
            <button className="text-button" onClick={onLocal} disabled={busy}>브라우저 작업으로 돌아가기</button>
          </> : <><p>계정 기록과 브라우저 기록은 따로 보관해요. 가져오기는 비어 있는 계정에만 복사하며 기존 원본은 유지합니다.</p>
            <button className="small-button" onClick={onOpen} disabled={busy}>계정 작업 공간 열기</button>
            <button className="text-button" onClick={onImport} disabled={busy}>이 브라우저의 프로젝트 가져오기</button>
          </>}
          <a className="text-button" href="/signout-with-chatgpt?return_to=%2F" target="_top" onClick={(event) => { if (cloud?.hasPending()) { event.preventDefault(); void cloud.flush().then(() => window.location.assign("/signout-with-chatgpt?return_to=%2F")).catch(() => {}); } }}>로그아웃</a>
        </>}
        <button className="text-button" disabled={preview} onClick={onBackup}>{cloud ? "현재 계정 기록 백업 내려받기" : "브라우저 기록 백업 내려받기"}</button>
        <p className="account-provider-note">백업은 글과 기록의 JSON 파일이에요. 그림·음악 원본은 작업 공간에서 따로 내려받아주세요.</p>
        {busy && <p role="status">기록과 파일을 확인하는 중…</p>}
        {error && <p className="field-error" role="alert">{error}</p>}
        <p className="account-provider-note">작품은 본인만 조회할 수 있어요.<br />자동 공개와 결제는 아직 제공하지 않아요.</p>
      </div>
    </details>
  </div>;
}
