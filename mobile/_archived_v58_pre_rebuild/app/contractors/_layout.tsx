import { Stack } from 'expo-router';
import { Colors } from '../../src/lib/colors';
export default function Layout() { return <Stack screenOptions={{ headerShown: true, headerBackTitle: 'Back', headerTintColor: Colors.paneltecBlue }} />; }
