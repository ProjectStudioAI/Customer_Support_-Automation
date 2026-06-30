import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export default function Tickets() {
  const [form, setForm] = useState({ title: "", description: "" });
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);

  const token = localStorage.getItem("token");
  const BASE = import.meta.env.VITE_SERVER_URL;

  const fetchTickets = async () => {
    try {
      const res = await fetch(`${BASE}/api/tickets`, {
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

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/tickets`, {
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

  return (
    <div className="p-6 max-w-3xl mx-auto">
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

      <h2 className="text-lg font-semibold text-gray-900 mb-3">Your Tickets</h2>
      <div className="space-y-3">
        {tickets.map((ticket) => (
          <Link
            key={ticket._id}
            className="block bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:shadow-md hover:border-indigo-200 transition-all duration-150"
            to={`/tickets/${ticket._id}`}
          >
            <h3 className="font-semibold text-gray-900 text-base">{ticket.title}</h3>
            <p className="text-sm text-gray-500 mt-1 line-clamp-2">{ticket.description}</p>
            <p className="text-xs text-gray-400 mt-2">
              {new Date(ticket.createdAt).toLocaleString()}
            </p>
          </Link>
        ))}
        {tickets.length === 0 && (
          <p className="text-gray-400 text-sm text-center py-8">No tickets submitted yet.</p>
        )}
      </div>
    </div>
  );
}
