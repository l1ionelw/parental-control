using System;
using System.Management;
using System.Security.Cryptography;
using System.Text;
using TrayApp;

namespace trayapp
{
    /// <summary>
    /// Produces a stable per-machine device ID from hardware identifiers (CPU +
    /// motherboard), hashed so the raw serials never leave the machine. Computed once
    /// and cached, since the WMI queries are relatively slow.
    /// </summary>
    internal static class DeviceInfo
    {
        private static string _cachedDeviceId;
        private static readonly object _lock = new object();

        public static string GetDeviceId()
        {
            lock (_lock)
            {
                if (_cachedDeviceId != null)
                    return _cachedDeviceId;

                string processorId = GetWmiProperty("Win32_Processor", "ProcessorId");
                string motherboardSerial = GetWmiProperty("Win32_BaseBoard", "SerialNumber");

                // Stable, unambiguous separator between the two components.
                string rawId = $"CPU:{processorId}|MB:{motherboardSerial}";
                _cachedDeviceId = Sha256Hex(rawId);

                Logger.Log($"DeviceInfo: device id resolved ({_cachedDeviceId.Substring(0, 8)}...)");
                return _cachedDeviceId;
            }
        }

        private static string GetWmiProperty(string wmiClass, string property)
        {
            try
            {
                using (var searcher = new ManagementObjectSearcher($"SELECT {property} FROM {wmiClass}"))
                using (var results = searcher.Get())
                {
                    foreach (ManagementObject obj in results)
                    {
                        using (obj)
                        {
                            var value = obj[property]?.ToString();
                            if (!string.IsNullOrWhiteSpace(value))
                                return value.Trim();
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Logger.Log($"DeviceInfo: WMI query {wmiClass}.{property} failed - {ex.GetType().Name}: {ex.Message}");
            }
            return "";
        }

        private static string Sha256Hex(string input)
        {
            using (var sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
                var sb = new StringBuilder(hash.Length * 2);
                foreach (byte b in hash)
                    sb.Append(b.ToString("x2"));
                return sb.ToString();
            }
        }
    }
}
