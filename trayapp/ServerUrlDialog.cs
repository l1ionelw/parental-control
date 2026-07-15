using System;
using System.Drawing;
using System.Windows.Forms;
using TrayApp;

namespace TrayApp
{
    internal class ServerUrlDialog : Form
    {
        public string ServerUrl { get; set; }

        private TextBox _urlTextBox;
        private Button _okButton;
        private Button _cancelButton;

        public ServerUrlDialog()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Text = "Parental Controls - Server Configuration";
            this.Size = new Size(480, 220);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = false;
            this.ShowInTaskbar = true;
            this.BackColor = Color.White;

            var label = new Label
            {
                Text = "Enter the Parental Controls server URL:",
                Location = new Point(20, 20),
                Size = new Size(430, 20),
                Font = new Font("Segoe UI", 9.5f, FontStyle.Regular),
                ForeColor = Color.FromArgb(51, 51, 51)
            };

            var hintLabel = new Label
            {
                Text = "Example: https://api.parentalcontrols.example.com",
                Location = new Point(20, 45),
                Size = new Size(430, 18),
                Font = new Font("Segoe UI", 8.5f, FontStyle.Italic),
                ForeColor = Color.FromArgb(128, 128, 128)
            };

_urlTextBox = new TextBox
            {
                Location = new Point(20, 80),
                Width = 400,
                Font = new Font("Segoe UI", 9.75F),
                Text = "https://"
            };
            _urlTextBox.TextChanged += (s, e) => ValidateInput();

            var buttonPanel = new Panel
            {
                Dock = DockStyle.Bottom,
                Height = 60,
                BackColor = Color.White
            };

            _okButton = new Button
            {
                Text = "Save & Connect",
                Location = new Point(255, 12),
                Size = new Size(110, 36),
                BackColor = Color.FromArgb(124, 58, 237),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9f, FontStyle.Bold),
                DialogResult = DialogResult.OK,
                Enabled = false
            };
            _okButton.FlatAppearance.BorderSize = 0;
            _okButton.Click += (s, e) => { Logger.Log($"Dialog OK clicked, ServerUrl={_urlTextBox.Text.Trim()}"); ServerUrl = _urlTextBox.Text.Trim(); };

            _cancelButton = new Button
            {
                Text = "Cancel",
                Location = new Point(375, 12),
                Size = new Size(85, 36),
                BackColor = Color.FromArgb(241, 245, 249),
                ForeColor = Color.FromArgb(71, 85, 105),
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 9f),
                DialogResult = DialogResult.Cancel
            };
            _cancelButton.FlatAppearance.BorderSize = 1;
            _cancelButton.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);

            buttonPanel.Controls.Add(_okButton);
            buttonPanel.Controls.Add(_cancelButton);

            this.Controls.Add(label);
            this.Controls.Add(hintLabel);
            this.Controls.Add(_urlTextBox);
            this.Controls.Add(buttonPanel);

            this.AcceptButton = _okButton;
            this.CancelButton = _cancelButton;
        }

        private void ValidateInput()
        {
            string text = _urlTextBox.Text.Trim();
            bool valid = Uri.TryCreate(text, UriKind.Absolute, out Uri uri) 
                && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
            _okButton.Enabled = valid;
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            Logger.Log($"Dialog OnLoad: ServerUrl={ServerUrl}");
            // Update TextBox with current ServerUrl each time dialog is shown
            if (!string.IsNullOrEmpty(ServerUrl))
            {
                _urlTextBox.Text = ServerUrl;
            }
            ValidateInput();
        }
    }
}