import { useState } from "react";

export default function ResolutionForm({ ticketId, onResolved }) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  const token = localStorage.getItem("token");
  const BASE = import.meta.env.VITE_SERVER_URL;

  const handleResolve = async () => {
    if (note.trim().length < 10) {
      alert("Please write a resolution note (minimum 10 characters)");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/tickets/${ticketId}/resolve`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ resolutionNote: note }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setNote("");
        onResolved();
      } else {
        alert((data && data.message) || "Failed to resolve ticket");
      }
    } catch (err) {
      console.error(err);
      alert("Error resolving ticket");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6 pt-6 border-t border-gray-100">
      <p className="text-sm font-semibold text-gray-900 mb-1">Resolve Ticket</p>
      <p className="text-xs text-gray-500 mb-3">
        Write a resolution note. This gets stored and helps resolve similar tickets in future.
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Describe how this issue was resolved..."
        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm resize-none"
        rows={4}
      />
      <button
        className="mt-3 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors duration-150 disabled:opacity-50"
        onClick={handleResolve}
        disabled={loading || note.trim().length < 10}
      >
        {loading ? "Resolving..." : "Mark as Resolved"}
      </button>
    </div>
  );
}
