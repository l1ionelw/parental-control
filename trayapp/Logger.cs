using System;
using System.Diagnostics;
using System.IO;

namespace TrayApp
{
    internal static class Logger
    {
        private static string _logFilePath;
        private static readonly object _lock = new object();

        static Logger()
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            _logFilePath = Path.Combine(appData, "ParentalControl", "trayapp.log");
            CreateLogFile();
        }

        public static void SetLogLocation(string filePath)
        {
            _logFilePath = filePath;
            CreateLogFile();
        }

        public static void Log(string message)
        {

            if (string.IsNullOrEmpty(_logFilePath))
                return;

            var timestamp = DateTime.Now.ToString("[MM-dd-yy HH-mm-ss]");
            var logEntry = $"{timestamp} {message}{Environment.NewLine}";
            Debug.WriteLine(logEntry);

            lock (_lock)
            {
                try
                {
                    File.AppendAllText(_logFilePath, logEntry);
                }
                catch
                {
                }
            }
        }

        private static void CreateLogFile()
        {
            if (string.IsNullOrEmpty(_logFilePath))
                return;

            try
            {
                var directory = Path.GetDirectoryName(_logFilePath);
                if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                if (!File.Exists(_logFilePath))
                {
                    File.Create(_logFilePath).Close();
                }
            }
            catch
            {
            }
        }
    }
}