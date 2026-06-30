import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import ResolutionForm from "../components/ResolutionForm";

export default function TicketDetailsPage() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);

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

  const fetchTicket = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SERVER_URL}/api/tickets/${id}`,
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

  if (loading)
    return <div className="text-center mt-10 text-gray-500">Loading ticket details...</div>;
  if (!ticket) return <div className="text-center mt-10 text-gray-500">Ticket not found</div>;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h2 className="text-2xl font-semibold text-gray-900 mb-6">Ticket Details</h2>
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
        <h3 className="text-xl font-semibold text-gray-900">{ticket.title}</h3>
        <p className="text-gray-600 text-sm leading-relaxed">{ticket.description}</p>

        {ticket.status && (
          <>
            <div className="divider text-xs text-gray-400">Ticket Info</div>

            <p className="text-sm text-gray-700">
              <span className="font-medium text-gray-900">Status:</span>{" "}
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                ticket.status === "RESOLVED" ? "bg-green-100 text-green-700" :
                ticket.status === "IN_PROGRESS" ? "bg-yellow-100 text-yellow-700" :
                "bg-gray-100 text-gray-600"
              }`}>{ticket.status}</span>
            </p>

            {ticket.priority && (
              <p className="text-sm text-gray-700">
                <span className="font-medium text-gray-900">Priority:</span>{" "}
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                  ticket.priority === "high" ? "bg-red-100 text-red-700" :
                  ticket.priority === "medium" ? "bg-yellow-100 text-yellow-700" :
                  "bg-green-100 text-green-700"
                }`}>{ticket.priority}</span>
              </p>
            )}

            {ticket.ticketType && (
              <p className="text-sm text-gray-700">
                <span className="font-medium text-gray-900">Type:</span> {ticket.ticketType}
              </p>
            )}
            {ticket.department && (
              <p className="text-sm text-gray-700">
                <span className="font-medium text-gray-900">Department:</span> {ticket.department}
              </p>
            )}

            {ticket.assignedTo && (
              <p className="text-sm text-gray-700">
                <span className="font-medium text-gray-900">Assigned To:</span> {ticket.assignedTo?.email}
              </p>
            )}

            {ticket.resolutionNote && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">Resolution Note</p>
                <p className="text-sm text-gray-700">{ticket.resolutionNote}</p>
                {ticket.resolvedAt && (
                  <p className="text-xs text-gray-400 mt-2">
                    Resolved {new Date(ticket.resolvedAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {user?.role !== "user" && ticket.similarTickets?.length > 0 && (
              <div className="mt-4">
                <div className="divider text-xs text-gray-400">Similar Past Tickets</div>
                <div className="space-y-2">
                  {ticket.similarTickets.map((t, i) => (
                    <div key={i} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <p className="text-sm font-medium text-gray-900">
                        {t.title}
                        <span className="text-xs text-gray-400 font-normal ml-2">
                          {Math.round(t.score * 100)}% match
                        </span>
                      </p>
                      {t.response && (
                        <p className="text-xs text-gray-500 mt-1">{t.response}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {user?.role !== "user" && ticket.status !== "RESOLVED" && (
              <ResolutionForm ticketId={ticket._id} onResolved={fetchTicket} />
            )}

            {ticket.createdAt && (
              <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">
                Created {new Date(ticket.createdAt).toLocaleString()}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
