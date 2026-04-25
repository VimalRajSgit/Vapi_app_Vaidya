import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import Vapi from "@vapi-ai/react-native";

const vapi = new Vapi("");

export default function HomeScreen() {
  const [status, setStatus] = useState("idle");

  const startCall = async () => {
    setStatus("calling");
    await vapi.start("");
  };

  const stopCall = () => {
    vapi.stop();
    setStatus("idle");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.status}>Status: {status}</Text>

      {status === "idle" ? (
        <TouchableOpacity style={styles.button} onPress={startCall}>
          <Text style={styles.buttonText}>Start Call</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.button, styles.stopButton]}
          onPress={stopCall}
        >
          <Text style={styles.buttonText}>Stop Call</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  status: { fontSize: 18, marginBottom: 30 },
  button: { backgroundColor: "#4CAF50", padding: 20, borderRadius: 50 },
  stopButton: { backgroundColor: "#f44336" },
  buttonText: { color: "white", fontSize: 18 },
});
