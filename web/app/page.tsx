import { ErrorBoundary } from "@/components/ErrorBoundary";
import SmartAlarmApp from "@/components/SmartAlarmApp";

export default function Home() {
  return (
    <ErrorBoundary>
      <SmartAlarmApp />
    </ErrorBoundary>
  );
}
