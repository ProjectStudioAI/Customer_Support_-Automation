import { Link, useNavigate } from "react-router-dom";

export default function Navbar() {
  const token = localStorage.getItem("token");
  let user = localStorage.getItem("user");
  if (user) {
    user = JSON.parse(user);
  }
  const navigate = useNavigate();

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
      <Link to="/" className="text-indigo-600 font-bold text-lg tracking-tight">
        Ticket AI
      </Link>
      <div className="flex items-center gap-4">
        {token && (
          <Link to="/" className="text-sm text-gray-600 hover:text-indigo-600 transition-colors">
            Tickets
          </Link>
        )}
        {!token ? (
          <>
            <Link to="/login" className="text-sm text-gray-600 hover:text-indigo-600 transition-colors">
              Login
            </Link>
            <Link
              to="/signup"
              className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg transition-colors"
            >
              Sign Up
            </Link>
          </>
        ) : (
          <>
            <span className="text-sm text-gray-500">{user?.email}</span>
            {user?.role === "admin" && (
              <Link to="/admin" className="text-sm text-gray-600 hover:text-indigo-600 transition-colors">
                Admin
              </Link>
            )}
            <button
              onClick={logout}
              className="text-sm text-gray-500 hover:text-red-500 transition-colors"
            >
              Logout
            </button>
          </>
        )}
      </div>
    </nav>
  );
}
