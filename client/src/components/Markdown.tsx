/**
 * Lesson text. The dialect is deliberately small (shared/markdown.ts parses it into plain data), so
 * there is no HTML to sanitise: this file only decides how each kind of block looks.
 */
import { parseMarkdown, type Block, type Inline } from "@shared/markdown";
import React, { useMemo } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";

export function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  return (
    <View style={styles.root}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </View>
  );
}

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineNode key={index} node={node} />
      ))}
    </>
  );
}

function InlineNode({ node }: { node: Inline }) {
  const { theme } = useTheme();
  switch (node.type) {
    case "text":
      return <>{node.text}</>;
    case "bold":
      return (
        <Text style={styles.bold}>
          <InlineNodes nodes={node.children} />
        </Text>
      );
    case "italic":
      return (
        <Text style={styles.italic}>
          <InlineNodes nodes={node.children} />
        </Text>
      );
    case "code":
      return <Text style={[styles.code, { backgroundColor: theme.surfaceAlt }]}>{node.text}</Text>;
    case "link":
      return (
        <Text accessibilityRole="link" onPress={() => void Linking.openURL(node.href)} style={{ color: theme.primaryText, textDecorationLine: "underline" }}>
          <InlineNodes nodes={node.children} />
        </Text>
      );
  }
}

function BlockView({ block }: { block: Block }) {
  const { theme } = useTheme();
  switch (block.type) {
    case "heading":
      return (
        <ThemedText type={block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4"} accessibilityRole="header" style={styles.heading}>
          <InlineNodes nodes={block.children} />
        </ThemedText>
      );
    case "paragraph":
      return (
        <ThemedText type="reading">
          <InlineNodes nodes={block.children} />
        </ThemedText>
      );
    case "list":
      return (
        <View style={styles.list} accessibilityRole="list">
          {block.items.map((item, index) => (
            <View key={index} style={styles.item}>
              <ThemedText type="reading" style={styles.marker}>
                {block.ordered ? `${index + 1}.` : "•"}
              </ThemedText>
              <ThemedText type="reading" style={{ flex: 1 }}>
                <InlineNodes nodes={item} />
              </ThemedText>
            </View>
          ))}
        </View>
      );
    case "quote":
      return (
        <View style={[styles.quote, { borderLeftColor: theme.primary, backgroundColor: theme.primaryTint }]}>
          <ThemedText type="reading">
            <InlineNodes nodes={block.children} />
          </ThemedText>
        </View>
      );
    case "rule":
      return <View style={[styles.rule, { backgroundColor: theme.border }]} />;
  }
}

const styles = StyleSheet.create({
  root: { gap: Spacing.md },
  heading: { marginTop: Spacing.sm },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  code: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  list: { gap: Spacing.xs },
  item: { flexDirection: "row", gap: Spacing.sm },
  marker: { minWidth: 24 },
  quote: { borderLeftWidth: 4, padding: Spacing.md, borderRadius: BorderRadius.sm },
  rule: { height: 1, marginVertical: Spacing.sm },
});
