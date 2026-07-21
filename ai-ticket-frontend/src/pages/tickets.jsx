import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE } from "../utils/apiBase";

export default function Tickets() {
  const [form, setForm] = useState({ title: "", description: "" });
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [moderators, setModerators] = useState([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState({});
  const [actionLoadingId, setActionLoadingId] = useState(null);

  const token = localStorage.getItem("token");
  let user = localStorage.getItem("user");
  if (user) {
    try {
      user = JSON.parse(user);
    } catch {
      user = null;
    }
  }
  const role = user?.role;

  const fetchModerators = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (res.ok && Array.isArray(data)) {
        setModerators(data.filter((item) => item.role === "moderator"));
      }
    } catch (err) {
      console.error("Failed to fetch users:", err);
    }
  };

  const fetchTickets = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tickets`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "GET",
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        console.error("Failed to fetch tickets, status:", res.status, data);
        setTickets([]);
        return;
      }

      if (Array.isArray(data)) {
        setTickets(data);
      } else if (data && Array.isArray(data.tickets)) {
        setTickets(data.tickets);
      } else {
        setTickets(data || []);
      }
    } catch (err) {
      console.error("Failed to fetch tickets:", err);
      setTickets([]);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  useEffect(() => {
    if (role === "admin") {
      fetchModerators();
    }
  }, [role]);

  useEffect(() => {
    const nextDrafts = {};
    tickets.forEach((ticket) => {
      nextDrafts[ticket._id] = ticket.assignedTo?._id || "";
    });
    setAssignmentDrafts(nextDrafts);
  }, [tickets]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tickets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });

      const data = await res.json().catch(() => null);

      if (res.ok) {
        setForm({ title: "", description: "" });
        fetchTickets();
      } else {
        alert(data.message || "Ticket creation failed");
      }
    } catch (err) {
      alert("Error creating ticket");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleClaim = async (ticketId) => {
    setActionLoadingId(ticketId);
    try {
      const res = await fetch(`${API_BASE}/api/tickets/${ticketId}/assign`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        fetchTickets();
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleAssign = async (ticketId) => {
    const moderatorId = assignmentDrafts[ticketId];
    if (!moderatorId) return;
    setActionLoadingId(ticketId);
    try {
      const res = await fetch(`${API_BASE}/api/tickets/${ticketId}/assign`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ moderatorId }),
      });
      if (res.ok) {
        fetchTickets();
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {role === "user" && (
        <>
          <h2 className="text-2xl font-semibold text-gray-900 mb-6">Create a Support Ticket</h2>

          <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4 mb-10">
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="Brief title of your issue"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              required
            />
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Describe your issue in detail..."
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm resize-none"
              rows={4}
              required
            />
            <button
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors duration-150 text-sm disabled:opacity-50"
              type="submit"
              disabled={loading}
            >
              {loading ? "Submitting..." : "Submit Ticket"}
            </button>
          </form>
        </>
      )}

      <h2 className="text-lg font-semibold text-gray-900 mb-3">Your Tickets</h2>
      <div className="space-y-3">
        {tickets.map((ticket) => (
          <div
            key={ticket._id}
            className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:shadow-md hover:border-indigo-200 transition-all duration-150"
          >
            <Link to={`/tickets/${ticket._id}`} className="block">
              <h3 className="font-semibold text-gray-900 text-base">{ticket.title}</h3>
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">{ticket.description}</p>
              <p className="text-xs text-gray-400 mt-2">
                {new Date(ticket.createdAt).toLocaleString()}
              </p>
            </Link>

            {role === "moderator" && !ticket.assignedTo && (
              <button
                type="button"
                onClick={() => handleClaim(ticket._id)}
                disabled={actionLoadingId === ticket._id}
                className="mt-3 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
              >
                ⚠️ Unassigned — {actionLoadingId === ticket._id ? "Claiming..." : "Claim this ticket"}
              </button>
            )}

            {role === "admin" && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                  {ticket.assignedTo?.email || "Unassigned"}
                </span>
                <select
                  className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900"
                  value={assignmentDrafts[ticket._id] || ""}
                  onChange={(e) => setAssignmentDrafts({ ...assignmentDrafts, [ticket._id]: e.target.value })}
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
                  onClick={() => handleAssign(ticket._id)}
                  disabled={actionLoadingId === ticket._id || !assignmentDrafts[ticket._id]}
                  className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {actionLoadingId === ticket._id ? "Assigning..." : "Assign"}
                </button>
              </div>
            )}
          </div>
        ))}
        {tickets.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-8">No tickets submitted yet.</p>
        )}
      </div>
    </div>
  );
}
