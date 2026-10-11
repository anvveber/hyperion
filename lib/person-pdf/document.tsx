import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { PDF_MONO, PDF_SANS, pdfFamily } from './fonts';
import type { PdfField, PdfImage, PdfItem, PdfSection, PersonPdfModel } from './model';

/*
 * Layout for the person PDF: a file-style header (photo, name, groups, record
 * line), then one block per section with a mono title and a gold marker, the
 * same language as the web UI. Labels sit in a narrow left column with values
 * to the right, so a printed page scans like a record card. Colors are chosen
 * for paper: near-black ink, mid-grey secondary text, one gold accent.
 */

const INK = '#161616';
const MUTED = '#666666';
const RULE = '#D6D6D6';
const TAG_BG = '#EFEFEF';
const GOLD = '#A57E14';

function styles() {
  const sans = pdfFamily(PDF_SANS);
  const mono = pdfFamily(PDF_MONO);
  return StyleSheet.create({
    page: {
      paddingTop: 40,
      paddingBottom: 56,
      paddingHorizontal: 44,
      fontFamily: sans,
      fontSize: 9.5,
      color: INK,
      // No lineHeight here: on the page it stops react-pdf from drawing the
      // page-number footer. Text styles below set their own.
    },
    topBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      fontFamily: mono,
      fontSize: 7,
      letterSpacing: 1.2,
      color: MUTED,
      textTransform: 'uppercase',
      marginBottom: 18,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start' },
    photo: { width: 64, height: 64, objectFit: 'cover', marginRight: 16, borderRadius: 2 },
    initials: {
      width: 64,
      height: 64,
      marginRight: 16,
      backgroundColor: TAG_BG,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initialsText: { fontFamily: mono, fontSize: 18, color: MUTED },
    name: { fontSize: 22, fontWeight: 600, lineHeight: 1.15, letterSpacing: -0.3 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
    tag: {
      fontFamily: mono,
      fontSize: 7,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      color: INK,
      backgroundColor: TAG_BG,
      paddingVertical: 2,
      paddingHorizontal: 5,
      marginRight: 4,
      marginBottom: 3,
    },
    metaRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: 14,
      paddingVertical: 6,
      borderTopWidth: 1.5,
      borderTopColor: GOLD,
      borderBottomWidth: 0.5,
      borderBottomColor: RULE,
    },
    metaItem: { flexDirection: 'row', marginRight: 18 },
    metaLabel: { fontFamily: mono, fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginRight: 5 },
    metaValue: { fontFamily: mono, fontSize: 7, color: INK },
    // flexShrink 0 throughout: near the foot of a page yoga would otherwise
    // squeeze blocks to fit, drawing their lines on top of each other.
    section: { marginTop: 18, flexShrink: 0 },
    keep: { flexShrink: 0 },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: 4,
      marginBottom: 6,
      borderBottomWidth: 0.5,
      borderBottomColor: RULE,
    },
    marker: { width: 5, height: 5, backgroundColor: GOLD, marginRight: 6 },
    sectionTitle: { fontFamily: mono, fontSize: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1.2 },
    fieldRow: { flexDirection: 'row', paddingVertical: 3, flexShrink: 0 },
    fieldLabel: {
      width: '28%',
      paddingRight: 10,
      paddingTop: 1.5,
      fontFamily: mono,
      fontSize: 7,
      color: MUTED,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    fieldValues: { width: '72%' },
    item: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 2.5 },
    itemTag: {
      fontFamily: mono,
      fontSize: 6.5,
      color: MUTED,
      backgroundColor: TAG_BG,
      paddingVertical: 1.5,
      paddingHorizontal: 4,
      marginRight: 6,
      marginTop: 1,
    },
    itemBody: { flexShrink: 1, flexGrow: 1, maxWidth: '100%' },
    itemText: { fontSize: 9.5, lineHeight: 1.4 },
    itemSuperseded: { fontSize: 9, lineHeight: 1.4, color: MUTED, textDecoration: 'line-through' },
    itemDetail: { fontFamily: mono, fontSize: 7, lineHeight: 1.35, color: MUTED, marginTop: 1 },
    paragraph: { marginBottom: 6, flexShrink: 0 },
    // lineHeight needs an explicit fontSize next to it, or react-pdf scales it
    // from its default size instead of the inherited one.
    line: { fontSize: 9.5, lineHeight: 1.45 },
    // Space after a lead line that was a whole paragraph on its own.
    leadGap: { marginBottom: 6 },
    entryGap: { marginTop: 10 },
    entryHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 3 },
    entryHeading: { fontSize: 10, fontWeight: 600, flexShrink: 1, paddingRight: 8 },
    entryMeta: { fontFamily: mono, fontSize: 7, color: MUTED },
    grid: { flexDirection: 'row', marginHorizontal: -4 },
    cell: { width: '33.333%', padding: 4 },
    gridImage: { width: '100%', height: 120, objectFit: 'cover', backgroundColor: TAG_BG },
    caption: { fontFamily: mono, fontSize: 6.5, color: MUTED, marginTop: 3 },
    more: { fontFamily: mono, fontSize: 7, color: MUTED, marginTop: 4 },
    footerRule: { position: 'absolute', bottom: 36, left: 44, right: 44, height: 0.5, backgroundColor: RULE },
    footerLeft: { position: 'absolute', bottom: 22, left: 44, right: 160, fontFamily: mono, fontSize: 7, color: MUTED },
    footerRight: { position: 'absolute', bottom: 22, right: 44, width: 140, textAlign: 'right', fontFamily: mono, fontSize: 7, color: MUTED },
  });
}

type Styles = ReturnType<typeof styles>;

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function ItemView({ item, s }: { item: PdfItem; s: Styles }) {
  return (
    <View style={s.item} wrap={false}>
      {item.tag ? <Text style={s.itemTag}>{item.tag}</Text> : null}
      <View style={s.itemBody}>
        <Text style={item.superseded ? s.itemSuperseded : s.itemText}>{item.text}</Text>
        {item.detail ? <Text style={s.itemDetail}>{item.detail}</Text> : null}
      </View>
    </View>
  );
}

function FieldView({ field, s }: { field: PdfField; s: Styles }) {
  return (
    <View style={s.fieldRow} wrap={field.items.length > 6}>
      <Text style={s.fieldLabel}>{field.label}</Text>
      <View style={s.fieldValues}>
        {field.items.map((item, i) => (
          <ItemView key={i} item={item} s={s} />
        ))}
      </View>
    </View>
  );
}

/**
 * A paragraph whose lines each get their own Text. A single Text holding
 * line breaks gets doubled line gaps in react-pdf once lineHeight is set.
 */
function Paragraph({ text, s }: { text: string; s: Styles }) {
  return (
    <View style={s.paragraph}>
      {text.split('\n').map((line, i) => (
        <Text key={i} style={s.line}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/**
 * Split off the first line of the first paragraph. That line is all that
 * travels with a title in an unbreakable block: binding a whole paragraph
 * would push a long one past the foot of the page, where it gets cut off.
 */
function splitLead(paragraphs: string[]): { lead: string | null; rest: string[] } {
  if (paragraphs.length === 0) return { lead: null, rest: [] };
  const [first, ...others] = paragraphs;
  const newline = first.indexOf('\n');
  if (newline === -1) return { lead: first, rest: others };
  return { lead: first.slice(0, newline), rest: [first.slice(newline + 1), ...others], };
}

function SectionTitle({ title, s }: { title: string; s: Styles }) {
  return (
    <View style={s.sectionTitleRow}>
      <View style={s.marker} />
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

function ImageRow({ images, s }: { images: PdfImage[]; s: Styles }) {
  return (
    <View style={s.grid} wrap={false}>
      {images.map((img, i) => (
        <View key={i} style={s.cell}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt */}
          <Image src={img.data} style={s.gridImage} />
          <Text style={s.caption}>{img.caption}</Text>
        </View>
      ))}
    </View>
  );
}

function SectionView({ section, s }: { section: PdfSection; s: Styles }) {
  if (section.kind === 'images') {
    // Rows of three. The title and the first row form one unbreakable block,
    // so the title can never end up alone at the foot of a page.
    const rows: PdfImage[][] = [];
    for (let i = 0; i < section.images.length; i += 3) rows.push(section.images.slice(i, i + 3));
    return (
      <View style={s.section}>
        <View style={s.keep} wrap={false}>
          <SectionTitle title={section.title} s={s} />
          <ImageRow images={rows[0] ?? []} s={s} />
        </View>
        {rows.slice(1).map((row, i) => (
          <ImageRow key={i} images={row} s={s} />
        ))}
        {section.more ? <Text style={s.more}>{section.more}</Text> : null}
      </View>
    );
  }

  // The title travels with the first piece of content in one unbreakable
  // block, so a title never ends up alone at the foot of a page.
  if (section.kind === 'fields') {
    const [first, ...rest] = section.fields;
    return (
      <View style={s.section}>
        <View style={s.keep} wrap={false}>
          <SectionTitle title={section.title} s={s} />
          {first ? <FieldView field={first} s={s} /> : null}
        </View>
        {rest.map((field, i) => (
          <FieldView key={i} field={field} s={s} />
        ))}
      </View>
    );
  }

  if (section.kind === 'text') {
    const { lead, rest } = splitLead(section.paragraphs);
    const continues = section.paragraphs[0]?.includes('\n') ?? false;
    return (
      <View style={s.section}>
        <View style={s.keep} wrap={false}>
          <SectionTitle title={section.title} s={s} />
          {lead !== null ? <Text style={[s.line, continues ? {} : s.leadGap]}>{lead}</Text> : null}
        </View>
        {rest.map((p, i) => (
          <Paragraph key={i} text={p} s={s} />
        ))}
      </View>
    );
  }

  // Entries are laid out flat inside the section (no wrapper View per entry):
  // an unbreakable block nested one level deeper than this gets drawn on top
  // of the lines that follow it when it lands at the foot of a page.
  return (
    <View style={s.section}>
      {section.entries.flatMap((entry, i) => {
        const { lead, rest } = splitLead(entry.paragraphs);
        const continues = entry.paragraphs[0]?.includes('\n') ?? false;
        return [
          <View key={`h${i}`} style={[s.keep, i > 0 ? s.entryGap : {}]} wrap={false}>
            {i === 0 ? <SectionTitle title={section.title} s={s} /> : null}
            <View style={s.entryHead}>
              <Text style={s.entryHeading}>{entry.heading}</Text>
              {entry.meta ? <Text style={s.entryMeta}>{entry.meta}</Text> : null}
            </View>
            {lead !== null ? <Text style={[s.line, continues ? {} : s.leadGap]}>{lead}</Text> : null}
          </View>,
          ...rest.map((p, j) => <Paragraph key={`p${i}-${j}`} text={p} s={s} />),
        ];
      })}
    </View>
  );
}

export function PersonPdfDocument({ model }: { model: PersonPdfModel }) {
  const s = styles();
  return (
    <Document title={model.name} author={model.labels.appName} creator={model.labels.appName} producer={model.labels.appName}>
      <Page size="A4" style={s.page}>
        <View style={s.topBar} fixed>
          <Text>{model.labels.appName}</Text>
          <Text>{model.generated}</Text>
        </View>

        <View style={s.header}>
          {model.photo ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt
            <Image src={model.photo} style={s.photo} />
          ) : (
            <View style={s.initials}>
              <Text style={s.initialsText}>{initialsOf(model.name)}</Text>
            </View>
          )}
          <View style={{ flexGrow: 1, flexShrink: 1 }}>
            <Text style={s.name}>{model.name}</Text>
            {model.tags.length > 0 && (
              <View style={s.tags}>
                {model.tags.map((tag, i) => (
                  <Text key={i} style={s.tag}>
                    {tag}
                  </Text>
                ))}
              </View>
            )}
          </View>
        </View>

        <View style={s.metaRow}>
          {model.meta.map((m, i) => (
            <View key={i} style={s.metaItem}>
              <Text style={s.metaLabel}>{m.label}</Text>
              <Text style={s.metaValue}>{m.value}</Text>
            </View>
          ))}
        </View>

        {model.sections.map((section, i) => (
          <SectionView key={i} section={section} s={s} />
        ))}

        {/* Footer: two fixed, absolutely placed lines so they repeat on every page. */}
        <View style={s.footerRule} fixed />
        <Text style={s.footerLeft} fixed>
          {model.name}
        </Text>
        <Text
          style={s.footerRight}
          fixed
          render={({ pageNumber, totalPages }) =>
            model.pageLabel.replace('{page}', String(pageNumber)).replace('{total}', String(totalPages))
          }
        />
      </Page>
    </Document>
  );
}
