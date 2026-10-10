import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "./styles/index.css";
import { AppLayout } from "./components/app/AppLayout";

const Landing = lazy(() => import("./pages/Landing"));
const Overview = lazy(() => import("./pages/app/Overview"));
const Assessments = lazy(() => import("./pages/app/Assessments"));
const NewAssessment = lazy(() => import("./pages/app/NewAssessment"));
const RunView = lazy(() => import("./pages/app/RunView"));
const Brief = lazy(() => import("./pages/app/Brief"));
const Compare = lazy(() => import("./pages/app/Compare"));
const Ledger = lazy(() => import("./pages/app/Ledger"));
const Plan = lazy(() => import("./pages/app/Plan"));
const Prove = lazy(() => import("./pages/app/Prove"));
const Breathe = lazy(() => import("./pages/app/Breathe"));

const Fallback = () => <div className="grid h-full min-h-[40vh] place-items-center"><div className="size-5 animate-spin rounded-full border-2 border-black/10 border-t-brand" /></div>;
const S = (el: React.ReactNode) => <Suspense fallback={<Fallback />}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: "/", element: S(<Landing />) },
  {
    path: "/app",
    element: <AppLayout />,
    children: [
      { index: true, element: S(<Overview />) },
      { path: "assessments", element: S(<Assessments />) },
      { path: "new", element: S(<NewAssessment />) },
      { path: "runs/:id", element: S(<RunView />) },
      { path: "runs/:id/brief", element: S(<Brief />) },
      { path: "compare", element: S(<Compare />) },
      { path: "ledger", element: S(<Ledger />) },
      { path: "plan", element: S(<Plan />) },
      { path: "track-record", element: S(<Prove />) },
      { path: "breathe", element: S(<Breathe />) },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
