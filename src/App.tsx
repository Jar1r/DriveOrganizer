import { Routes, Route, Navigate } from "react-router-dom";
import Landing from "./pages/Landing";
import Organizer from "./pages/Organizer";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<Organizer />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
