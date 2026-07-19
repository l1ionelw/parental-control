namespace trayapp.Structs
{
    // Emitted by PreviousAppUsedTracker whenever a completed app session clears the
    // debounce window. Carries both halves of the switch - the finished session
    // (Previous/StartTime/EndTime) and the app just switched to (Current) - so every
    // subscriber gets the full picture instead of re-resolving "what's focused now"
    // itself.
    struct AppSwitchedEvent
    {
        public Application Previous;
        public long StartTime; // when 'Previous' gained focus
        public long EndTime;   // when focus left 'Previous' == the switch moment
        public Application Current; // the app just switched to
    }
}
