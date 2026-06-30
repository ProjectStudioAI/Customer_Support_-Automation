import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

export default function VerifyEmailPage() {
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const email = location.state?.email || localStorage.getItem("signupEmail");

  if (!email) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Email Verification</h1>
          <p className="text-sm text-red-600 mb-4">No email found. Please sign up first.</p>
          <button
            onClick={() => navigate("/signup")}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            Go to Sign Up
          </button>
        </div>
      </div>
    );
  }

  const handleVerify = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SERVER_URL}/api/auth/verify-email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, otp }),
        }
      );

      const data = await res.json();

      if (res.ok) {
        setSuccess("Email verified successfully! Redirecting to login...");
        setTimeout(() => {
          localStorage.removeItem("signupEmail");
          navigate("/login");
        }, 2000);
      } else {
        setError(data.error || "Verification failed");
      }
    } catch (err) {
      setError("Something went wrong. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError("");
    setSuccess("");
    setResendLoading(true);

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SERVER_URL}/api/auth/resend-otp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        }
      );

      const data = await res.json();

      if (res.ok) {
        setSuccess("OTP sent successfully! Check your email.");
        setOtp("");
      } else {
        setError(data.error || "Failed to resend OTP");
      }
    } catch (err) {
      setError("Something went wrong. Please try again.");
      console.error(err);
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
        <h1 className="text-2xl font-semibold text-gray-900 text-center mb-1">
          Verify Email
        </h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          Enter the code sent to your email
        </p>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-center mb-4">
          <p className="text-gray-500">Verification code sent to:</p>
          <p className="font-medium text-gray-900">{email}</p>
        </div>

        <form onSubmit={handleVerify}>
          {error && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-red-50 border border-red-200 text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 rounded-lg text-sm bg-green-50 border border-green-200 text-green-700">
              {success}
            </div>
          )}

          <input
            type="text"
            placeholder="Enter 6-digit OTP"
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm mb-4 text-center tracking-widest"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            maxLength="6"
            required
            disabled={loading || !!success}
          />

          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50"
            disabled={loading || !otp || !!success}
          >
            {loading ? "Verifying..." : "Verify OTP"}
          </button>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-gray-400">or</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleResendOtp}
            className="w-full text-sm text-gray-600 hover:text-indigo-600 transition-colors disabled:opacity-50"
            disabled={resendLoading || loading}
          >
            {resendLoading ? "Sending..." : "Resend OTP"}
          </button>

          <button
            type="button"
            onClick={() => navigate("/login")}
            className="w-full mt-3 text-sm text-indigo-600 hover:underline"
          >
            Back to Login
          </button>
        </form>
      </div>
    </div>
  );
}
