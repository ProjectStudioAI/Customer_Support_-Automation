import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ResolutionForm from "../components/ResolutionForm";
import { API_BASE } from "../utils/apiBase";

export default function TicketDetailsPage() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [moderators, setModerators] = useState([]);
  const [assignmentDraft, setAssignmentDraft] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const token = localStorage.getItem("token");

  useEffect(() => {
    try {
      if (token) {
        const payload = JSON.parse(atob(token.split(".")[1]));
        setUser(payload);
      }
    } catch {
      setUser(null);
    }
  }, [token]);

  useEffect(() => {
    const fetchModerators = async () => {
      if (user?.role !== "admin") return;
      try {
        const res = await fetch(`${API_BASE}/api/auth/users`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (res.ok && Array.isArray(data)) {
          setModerators(data.filter((item) => item.role === "moderator"));
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchModerators();
  }, [user, token]);

  const fetchTicket = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/tickets/${id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) {
        alert((data && data.message) || "Failed to fetch ticket");
      } else {
        setTicket(data.ticket);
      }
    } catch (err) {
      console.error(err);
      alert("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTicket();
  }, [id]);

  useEffect(() => {
    setAssignmentDraft(ticket?.assignedTo?._id || "");
  }, [ticket]);

  const handleClaim = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tickets/${id}/assign`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        fetchTicket();
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!assignmentDraft) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tickets/${id}/assign`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ moderatorId: assignmentDraft }),
      });
      if (res.ok) {
        fetchTicket();
      }
    } finally {
      setActionLoading(false);
    }
  };

  if (loading)
    return <div className="text-center mt-10 text-gray-500">Loading ticket details...</div>;
  if (!ticket) return <div className="text-center mt-10 text-gray-500">Ticket not found</div>;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-5">Ticket Details</h2>
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900">{ticket.title}</h3>
        <p className="text-sm text-gray-600 mt-2 leading-relaxed">{ticket.description}</p>

        {ticket.status && (
          <div className="mt-5 pt-5 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Ticket Info</p>
            <div className="space-y-2.5">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-28 shrink-0">Status</span>
                <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  ticket.status === "RESOLVED" ? "bg-green-100 text-green-700" :
                  ticket.status === "IN_PROGRESS" ? "bg-yellow-100 text-yellow-700" :
                  "bg-gray-100 text-gray-600"
                }`}>{ticket.status.replace("_", " ")}</span>
              </div>

              {ticket.priority && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 w-28 shrink-0">Priority</span>
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    ticket.priority === "high" ? "bg-red-100 text-red-700" :
                    ticket.priority === "medium" ? "bg-yellow-100 text-yellow-700" :
                    "bg-green-100 text-green-700"
                  }`}>{ticket.priority}</span>
                </div>
              )}

              {ticket.ticketType && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 w-28 shrink-0">Type</span>
                  <span className="text-sm text-gray-700">{ticket.ticketType}</span>
                </div>
              )}

              {ticket.department && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 w-28 shrink-0">Department</span>
                  <span className="text-sm text-gray-700">{ticket.department}</span>
                </div>
              )}

              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-28 shrink-0">Assigned To</span>
                <span className="text-sm text-gray-700">{ticket.assignedTo?.email || "Unassigned"}</span>
              </div>

              {ticket.createdAt && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 w-28 shrink-0">Created</span>
                  <span className="text-sm text-gray-500">{new Date(ticket.createdAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {user?.role !== "user" && (
          <>
            {user?.role === "moderator" && !ticket.assignedTo && (
              <button
                type="button"
                onClick={handleClaim}
                disabled={actionLoading}
                className="mt-5 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
              >
                ⚠️ Unassigned — {actionLoading ? "Claiming..." : "Claim this ticket"}
              </button>
            )}

            {user?.role === "admin" && (
              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                  {ticket.assignedTo?.email || "Unassigned"}
                </span>
                <select
                  className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
                  value={assignmentDraft}
                  onChange={(e) => setAssignmentDraft(e.target.value)}
                >
                  <option value="">Select moderator</option>
                  {moderators.map((moderator) => (
                    <option key={moderator._id} value={moderator._id}>
                      {moderator.email}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAssign}
                  disabled={actionLoading || !assignmentDraft}
                  className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {actionLoading ? "Assigning..." : "Assign"}
                </button>
              </div>
            )}

            {ticket.helpfulNotes && (
              <div className="mt-5 pt-5 border-t border-gray-100">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Helpful Notes</p>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="text-xs text-amber-600 mb-2">From similar resolved tickets in the knowledge base</p>
                  <p className="text-sm text-gray-700 whitespace-pre-line">{ticket.helpfulNotes}</p>
                </div>
              </div>
            )}

            {ticket.status !== "RESOLVED" && (
              <ResolutionForm ticketId={ticket._id} onResolved={fetchTicket} />
            )}

            {ticket.resolutionNote && ticket.status === "RESOLVED" && (
              <div className="mt-5 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Internal Resolution Note</p>
                <p className="text-sm text-gray-700">{ticket.resolutionNote}</p>
                {ticket.resolvedAt && (
                  <p className="text-xs text-gray-400 mt-2">Resolved {new Date(ticket.resolvedAt).toLocaleString()}</p>
                )}
              </div>
            )}

            {ticket.status === "RESOLVED" && (
              <div className="mt-5 pt-5 border-t border-gray-100">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <span>🔒</span>
                  <span>This ticket is resolved and locked. To report a new issue, please create a new ticket.</span>
                </div>
              </div>
            )}
          </>
        )}

        {user?.role === "user" && (
          <>
            {ticket.generatedResponse && ticket.status !== "RESOLVED" && (
              <div className="mt-5 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-1">Our Response</p>
                <p className="text-sm text-gray-700 leading-relaxed">{ticket.generatedResponse}</p>
              </div>
            )}

            {ticket.status === "RESOLVED" && (
              <div className="mt-5 bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">Resolved</p>
                <p className="text-sm text-gray-700">
                  Thank you for reaching out. Your ticket has been reviewed and resolved
                  by our support team. We hope this has addressed your concern. Please
                  raise a new ticket if you need further assistance.
                </p>
                {ticket.resolvedAt && (
                  <p className="text-xs text-gray-400 mt-2">Resolved {new Date(ticket.resolvedAt).toLocaleString()}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
