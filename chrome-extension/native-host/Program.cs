using System;
using System.IO;
using System.Management;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace native_host
{
    class Program
    {
        // Chrome native messaging protocol: read a 4-byte little-endian length,
        // then that many UTF-8 bytes, then write back the same framing.
        static int Main(string[] args)
        {
            try
            {
                var config = ReadTrayAppConfig();
                var deviceId = GetDeviceId();
                var deviceName = Environment.MachineName;
                var osUsername = Environment.UserName;

                var response = new
                {
                    deviceId,
                    deviceName,
                    osUsername,
                    serverUrl = config.ServerUrl,
                };

                WriteMessage(new JavaScriptSerializer().Serialize(response));

                // Keep the process alive until Chrome closes the pipe so the
                // connection isn't torn down immediately after the first message.
                WaitForStdinClose();
                return 0;
            }
            catch (Exception ex)
            {
                WriteMessage(new JavaScriptSerializer().Serialize(new { error = ex.Message }));
                return 1;
            }
        }

        static TrayAppConfig ReadTrayAppConfig()
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var configPath = Path.Combine(appData, "ParentalControl", "trayapp_config.json");

            if (!File.Exists(configPath))
                return new TrayAppConfig();

            try
            {
                var json = File.ReadAllText(configPath);
                var serializer = new JavaScriptSerializer();
                var config = serializer.Deserialize<TrayAppConfig>(json);
                return config ?? new TrayAppConfig();
            }
            catch
            {
                return new TrayAppConfig();
            }
        }

        static string GetDeviceId()
        {
            string processorId = GetWmiProperty("Win32_Processor", "ProcessorId");
            string motherboardSerial = GetWmiProperty("Win32_BaseBoard", "SerialNumber");
            string rawId = string.Format("CPU:{0}|MB:{1}", processorId, motherboardSerial);
            return Sha256Hex(rawId);
        }

        static string GetWmiProperty(string wmiClass, string property)
        {
            try
            {
                using (var searcher = new ManagementObjectSearcher(string.Format("SELECT {0} FROM {1}", property, wmiClass)))
                using (var results = searcher.Get())
                {
                    foreach (ManagementObject obj in results)
                    {
                        using (obj)
                        {
                            var value = obj[property] == null ? null : obj[property].ToString();
                            if (!string.IsNullOrWhiteSpace(value))
                                return value.Trim();
                        }
                    }
                }
            }
            catch { }
            return "";
        }

        static string Sha256Hex(string input)
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

        static void WriteMessage(string json)
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            var lengthBytes = BitConverter.GetBytes(bytes.Length);
            var stdout = Console.OpenStandardOutput();
            if (BitConverter.IsLittleEndian)
            {
                stdout.Write(lengthBytes, 0, 4);
                stdout.Write(bytes, 0, bytes.Length);
                stdout.Flush();
            }
        }

        static void WaitForStdinClose()
        {
            try
            {
                var stdin = Console.OpenStandardInput();
                var buffer = new byte[1024];
                while (true)
                {
                    var read = stdin.Read(buffer, 0, buffer.Length);
                    if (read == 0)
                        break;
                }
            }
            catch { }
        }
    }

    class TrayAppConfig
    {
        public string ServerUrl { get; set; }

        public TrayAppConfig()
        {
            ServerUrl = "";
        }
    }
}
