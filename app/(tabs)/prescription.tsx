import { useState, useEffect } from "react";
import {
  View,
  Text,
  Button,
  Image,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Share,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import * as Notifications from "expo-notifications";

const PRESCRIPTO_KEY = "";
const GROQ_KEY = "";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Parse times like "8:00 AM", "morning", "night" from summary text
const extractTimesFromSummary = (summary: string): string[] => {
  const timeRegex =
    /\b(\d{1,2}:\d{2}\s*(AM|PM|am|pm)?|\d{1,2}\s*(AM|PM|am|pm))\b/g;
  const keywordMap: Record<string, string> = {
    morning: "8:00 AM",
    breakfast: "8:00 AM",
    afternoon: "1:00 PM",
    lunch: "1:00 PM",
    evening: "6:00 PM",
    night: "9:00 PM",
    dinner: "7:00 PM",
    bedtime: "10:00 PM",
  };

  const times: string[] = [];

  const matches = summary.match(timeRegex);
  if (matches) times.push(...matches);

  Object.keys(keywordMap).forEach((keyword) => {
    if (summary.toLowerCase().includes(keyword)) {
      times.push(keywordMap[keyword]);
    }
  });

  return [...new Set(times)]; // remove duplicates
};

const parseTimeTo24Hour = (
  timeStr: string,
): { hour: number; minute: number } | null => {
  const clean = timeStr.trim().toUpperCase();
  const match = clean.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/);
  if (!match) return null;

  let hour = parseInt(match[1]);
  const minute = parseInt(match[2] || "0");
  const period = match[3];

  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;

  return { hour, minute };
};

export default function PrescriptionScreen() {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [remindersSet, setRemindersSet] = useState(false);

  useEffect(() => {
    Notifications.requestPermissionsAsync();
  }, []);

  const saveToGallery = async (uri: string) => {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status === "granted") {
      const asset = await MediaLibrary.createAssetAsync(uri);
      const album = await MediaLibrary.getAlbumAsync("Vapi");
      if (album) {
        await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
      } else {
        await MediaLibrary.createAlbumAsync("Vapi", asset, false);
      }
    }
  };

  const openVapiFolder = async () => {
    const album = await MediaLibrary.getAlbumAsync("Vapi");
    if (album) {
      await Linking.openURL("content://media/external/images/media");
    } else {
      alert("No Vapi folder found yet! Scan a prescription first.");
    }
  };

  const shareSummary = async () => {
    if (!summary) return;
    await Share.share({
      message: `📋 Prescription Summary:\n\n${summary}`,
    });
  };

  const setMedicineReminders = async (summaryText: string) => {
    const times = extractTimesFromSummary(summaryText);

    if (times.length === 0) {
      alert("No medicine timings found in summary!");
      return;
    }

    // Cancel old notifications first
    await Notifications.cancelAllScheduledNotificationsAsync();

    for (const timeStr of times) {
      const parsed = parseTimeTo24Hour(timeStr);
      if (!parsed) continue;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: "💊 Medicine Reminder",
          body: `Time to take your medicine! (${timeStr})`,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: parsed.hour,
          minute: parsed.minute,
        },
      });
    }

    setRemindersSet(true);
    alert(`✅ Reminders set for: ${times.join(", ")}`);
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      alert("Permission needed!");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
    });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setImage(uri);
      await saveToGallery(uri);
      await processImage(uri);
    }
  };

  const scanImage = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      alert("Camera permission needed!");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setImage(uri);
      await saveToGallery(uri);
      await processImage(uri);
    }
  };

  const processImage = async (uri: string) => {
    setLoading(true);
    setResult(null);
    setSummary(null);
    setRemindersSet(false);

    try {
      const formData = new FormData();
      formData.append("prescription", {
        uri,
        name: `prescription_${new Date().toISOString().split("T")[0]}.png`,
        type: "image/png",
      } as any);

      const prescriptoRes = await fetch(
        "https://www.prescriptoai.com/api/v1/prescription/extract",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${PRESCRIPTO_KEY}`,
            Accept: "application/json",
          },
          body: formData,
        },
      );

      const prescriptoData = await prescriptoRes.json();
      setResult(prescriptoData);

      const groqRes = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GROQ_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "user",
                content: `Summarize this prescription in simple patient-friendly words. Include medicine names, dosages, and exact timings (e.g. 8:00 AM, 1:00 PM, 9:00 PM):\n\n${JSON.stringify(prescriptoData)}`,
              },
            ],
          }),
        },
      );

      const groqData = await groqRes.json();
      const summaryText = groqData.choices[0].message.content;
      setSummary(summaryText);
    } catch (error) {
      console.error(error);
      alert("Something went wrong!");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Prescription Scanner</Text>

      <View style={styles.buttons}>
        <Button title="📷 Scan Prescription" onPress={scanImage} />
        <Button title="🖼 Pick from Gallery" onPress={pickImage} />
      </View>

      <TouchableOpacity style={styles.folderButton} onPress={openVapiFolder}>
        <Text style={styles.folderButtonText}>📁 Open Vapi Folder</Text>
      </TouchableOpacity>

      {image && <Image source={{ uri: image }} style={styles.image} />}

      {loading && (
        <ActivityIndicator
          size="large"
          color="#0000ff"
          style={{ marginTop: 20 }}
        />
      )}

      {summary && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📋 Summary</Text>
          <Text style={styles.cardText}>{summary}</Text>

          <TouchableOpacity style={styles.shareButton} onPress={shareSummary}>
            <Text style={styles.shareButtonText}>📤 Share Summary</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.reminderButton,
              remindersSet && styles.reminderSetButton,
            ]}
            onPress={() => setMedicineReminders(summary)}
          >
            <Text style={styles.reminderButtonText}>
              {remindersSet ? "✅ Reminders Set!" : "⏰ Set Medicine Reminders"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {result && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔬 Raw Extracted Data</Text>
          <Text style={styles.cardText}>{JSON.stringify(result, null, 2)}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: "#fff" },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  buttons: { gap: 10, marginBottom: 20 },
  folderButton: {
    backgroundColor: "#2196F3",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 20,
  },
  folderButtonText: { color: "white", fontSize: 16, fontWeight: "bold" },
  image: {
    width: "100%",
    height: 200,
    resizeMode: "contain",
    marginBottom: 20,
  },
  card: {
    backgroundColor: "#f0f0f0",
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
  },
  cardTitle: { fontSize: 18, fontWeight: "bold", marginBottom: 10 },
  cardText: { fontSize: 14, lineHeight: 22 },
  shareButton: {
    backgroundColor: "#4CAF50",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 12,
  },
  shareButtonText: { color: "white", fontSize: 15, fontWeight: "bold" },
  reminderButton: {
    backgroundColor: "#FF9800",
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 10,
  },
  reminderSetButton: { backgroundColor: "#4CAF50" },
  reminderButtonText: { color: "white", fontSize: 15, fontWeight: "bold" },
});
