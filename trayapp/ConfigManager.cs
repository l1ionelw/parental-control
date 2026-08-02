using System;
using System.IO;
using System.Text.Json;

namespace TrayApp
{
    internal class TrayAppConfiguration
    {
        public string ServerUrl { get; set; }
    }

    internal static class ConfigManager
    {
        private static readonly string _configPath;

        static ConfigManager()
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var configDir = Path.Combine(appData, "ParentalControl");
            _configPath = Path.Combine(configDir, "trayapp_config.json");
        }

        public static TrayAppConfiguration CurrentConfig { get; private set; } = new TrayAppConfiguration();

        public static bool CheckForConfig()
        {
            try
            {
                if (!File.Exists(_configPath))
                {
                    Logger.Log("ConfigManager: No config file found at " + _configPath);
                    CurrentConfig = new TrayAppConfiguration();
                    return false;
                }

                string json = File.ReadAllText(_configPath);
                if (string.IsNullOrWhiteSpace(json))
                {
                    Logger.Log("ConfigManager: Config file is empty");
                    DeleteConfig();
                    CurrentConfig = new TrayAppConfiguration();
                    return false;
                }

                var config = JsonSerializer.Deserialize<TrayAppConfiguration>(json);
                if (config == null || string.IsNullOrEmpty(config.ServerUrl))
                {
                    Logger.Log("ConfigManager: Config deserialized but missing ServerUrl");
                    DeleteConfig();
                    CurrentConfig = new TrayAppConfiguration();
                    return false;
                }

                CurrentConfig = config;
                Logger.Log("ConfigManager: Valid config loaded, ServerUrl=" + config.ServerUrl);
                return true;
            }
            catch (Exception ex)
            {
                Logger.Log("ConfigManager: Failed to load config - " + ex.Message);
                DeleteConfig();
                CurrentConfig = new TrayAppConfiguration();
                return false;
            }
        }

        private static void DeleteConfig()
        {
            try
            {
                if (File.Exists(_configPath))
                {
                    File.Delete(_configPath);
                    Logger.Log("ConfigManager: Deleted invalid config file");
                }
            }
            catch (Exception ex)
            {
                Logger.Log("ConfigManager: Failed to delete config - " + ex.Message);
            }
        }

        public static void SaveConfig(string serverUrl)
        {
            try
            {
                var config = new TrayAppConfiguration
                {
                    ServerUrl = serverUrl
                };

                WriteToDisk(config);

                CurrentConfig = config;
                Logger.Log("ConfigManager: Config saved with ServerUrl=" + serverUrl);
            }
            catch (Exception ex)
            {
                Logger.Log("ConfigManager: Failed to save config - " + ex.Message);
            }
        }

        private static void WriteToDisk(TrayAppConfiguration config)
        {
            var directory = Path.GetDirectoryName(_configPath);
            if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }

            var options = new JsonSerializerOptions { WriteIndented = true };
            string json = JsonSerializer.Serialize(config, options);
            File.WriteAllText(_configPath, json);
        }
    }
}