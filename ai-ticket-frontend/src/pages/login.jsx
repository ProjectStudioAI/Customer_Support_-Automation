import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function LoginPage() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [requiresVerification, setRequiresVerification] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError("");
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setRequiresVerification(false);

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SERVER_URL}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(form),
        }
      );

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem("token", data.token);
        localStorage.setItem("user", JSON.stringify(data.user));
        navigate("/");
      } else {
        if (res.status === 403 && data.requiresVerification) {
          setRequiresVerification(true);
          localStorage.setItem("signupEmail", form.email);
          setError(data.error || "Please verify your email");
        } else {
          setError(data.error || "Login failed");
        }
      }
    } catch (err) {
      setError("Something went wrong");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setResendLoading(true);
    setError("");

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SERVER_URL}/api/auth/resend-otp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email: form.email }),
        }
      );

      const data = await res.json();

      if (res.ok) {
        navigate("/verify-email", { state: { email: form.email } });
      } else {
        setError(data.error || "Failed to resend OTP");
      }
    } catch (err) {
      setError("Something went wrong");
      console.error(err);
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
        <h1 className="text-2xl font-semibold text-gray-900 text-center mb-1">
          Welcome back
        </h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          Sign in to your account
        </p>

        <form onSubmit={handleLogin}>
          {error && (
            <div className={`mb-4 p-3 rounded-lg text-sm ${
              requiresVerification
                ? "bg-yellow-50 border border-yellow-200 text-yellow-800"
                : "bg-red-50 border border-red-200 text-red-700"
            }`}>
              {error}
            </div>
          )}

          <input
            type="email"
            name="email"
            placeholder="Email"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm mb-4"
            value={form.email}
            onChange={handleChange}
            required
          />

          <input
            type="password"
            name="password"
            placeholder="Password"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm mb-4"
            value={form.password}
            onChange={handleChange}
            required
          />

          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50"
            disabled={loading || requiresVerification}
          >
            {loading ? "Logging in..." : "Sign In"}
          </button>

          {requiresVerification && (
            <button
              type="button"
              onClick={handleResendOtp}
              className="w-full mt-3 bg-yellow-500 hover:bg-yellow-600 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
              disabled={resendLoading}
            >
              {resendLoading ? "Sending..." : "Verify Email Now"}
            </button>
          )}

          <p className="text-center text-sm text-gray-500 mt-4">
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={() => navigate("/signup")}
              className="text-indigo-600 hover:underline font-medium"
            >
              Sign up
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
