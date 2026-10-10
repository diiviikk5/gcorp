import { useRuns } from "@/store/runs";
import { ENDPOINT } from "@/lib/api";

// Planning, replays and the citizen view need the engine; say so plainly when it is down.
export function EngineGate({ children }: { children: React.ReactNode }) {
  const engine = useRuns((s) => s.engine);
  const connect = useRuns((s) => s.connect);
  if (engine === "online") return <div>{children}</div>;
  return (
    <div className="grid min-h-[70vh] place-items-center px-6 text-center">
      <div className="max-w-md">
        <div className="text-[15px] font-medium">{engine === "unknown" ? "Connecting to the engine…" : "The engine is not running"}</div>
        {engine === "offline" && (
          <>
            <p className="mt-2 text-[13.5px] text-mute">This view runs on the Gcorp engine. Start it from the terminal, then retry.</p>
            <pre className="mt-4 rounded-lg bg-s1 p-3 text-left font-mono text-[12.5px] ring-1 ring-inset ring-line">cd backend{"\n"}gcorp serve</pre>
            <p className="mt-2 font-mono text-[11px] text-faint">endpoint {ENDPOINT}</p>
            <button onClick={() => connect()} className="mt-4 text-[13px] font-medium underline underline-offset-4">Retry</button>
          </>
        )}
      </div>
    </div>
  );
}
