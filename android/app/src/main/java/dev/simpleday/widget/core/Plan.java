package dev.simpleday.widget.core;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Port of the SimpleDay text parser (frontend parser.js / simpleday_sync.py parse_plan). */
public final class Plan {
    static final Pattern TS = Pattern.compile("^(\\d{1,2}):(\\d{2})(?:\\s*[-\u2013]\\s*(\\d{1,2}):(\\d{2}))?\\s+");
    static final Pattern AS = Pattern.compile(
            "(?:^|\\s)(\\d+(?:\\.\\d+)?)\\s*h(?:\\s*(\\d{1,2})\\s*m)?\\+?(?=\\s|$)|(?:^|\\s)(\\d{1,3})\\s*m(?:in)?\\+?(?=\\s|$)",
            Pattern.CASE_INSENSITIVE);
    static final Pattern CS = Pattern.compile(
            "(?:^|\\s)!(\\d{1,3})\\s*(h|m)?(?=\\s|$)|(?:^|\\s)!(off)(?=\\s|$)", Pattern.CASE_INSENSITIVE);
    static final Pattern DS = Pattern.compile("(?:^|\\s)@\\s*(.*)$");
    static final Pattern HEADING = Pattern.compile("^#{1,3}\\s+(.*)$");
    static final Pattern ISO = Pattern.compile("^(\\d{4})-(\\d{2})-(\\d{2})\\b(.*)$");
    static final Pattern WD = Pattern.compile("^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\\b[,\\s]*");
    static final Pattern MD = Pattern.compile("^([A-Za-z]+)\\s+(\\d{1,2})(?:st|nd|rd|th)?[,\\s]*(\\d{4})?(.*)$");
    static final Pattern DM = Pattern.compile("^(\\d{1,2})(?:st|nd|rd|th)?\\s+([A-Za-z]+)[,\\s]*(\\d{4})?(.*)$");
    static final String[] MONTHS = {"jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"};
    static final String[] WDAYS = {"sun", "mon", "tue", "wed", "thu", "fri", "sat"};

    public static final class Item {
        public Integer start, end, dur;
        public String title, loc;
        public boolean floating;
    }

    public static final class Day {
        public LocalDate date;
        public String label;
        public final List<Item> items = new ArrayList<>();
    }

    public final List<Day> days = new ArrayList<>();

    private Plan() {}

    // ---- item line
    private static String[] take(Pattern p, String s, Matcher[] out) {
        Matcher m = p.matcher(s);
        if (m.find()) {
            out[0] = m;
            return new String[] {(s.substring(0, m.start()) + " " + s.substring(m.end())).trim()};
        }
        out[0] = null;
        return new String[] {s};
    }

    static Item parseItem(String raw) {
        String i = raw.trim();
        if (i.isEmpty()) return null;
        Item it = new Item();
        Matcher m = TS.matcher(i);
        if (m.find()) {
            it.start = Integer.parseInt(m.group(1)) * 60 + Integer.parseInt(m.group(2));
            if (m.group(3) != null) it.end = Integer.parseInt(m.group(3)) * 60 + Integer.parseInt(m.group(4));
            i = i.substring(m.end());
        }
        String loc = "";
        m = DS.matcher(i);
        if (m.find()) {
            loc = m.group(1).trim();
            i = i.substring(0, m.start());
        }
        Matcher[] got = new Matcher[1];
        i = take(CS, i, got)[0];
        if (got[0] == null) loc = take(CS, loc, got)[0];

        i = take(AS, i, got)[0];
        if (got[0] == null) loc = take(AS, loc, got)[0];
        if (got[0] != null) {
            Matcher g = got[0];
            if (g.group(1) != null) {
                it.dur = (int) Math.floor(Double.parseDouble(g.group(1)) * 60 + 0.5)
                        + (g.group(2) != null ? Integer.parseInt(g.group(2)) : 0);
            } else {
                it.dur = Integer.parseInt(g.group(3));
            }
        }
        if (it.end != null && it.dur == null) it.dur = it.end >= it.start ? it.end - it.start : it.end + 1440 - it.start;
        if (it.dur != null && it.end == null && it.start != null) it.end = it.start + it.dur;

        String title = i.replaceAll("\\s{2,}", " ").trim();
        it.title = title.isEmpty() ? "(untitled)" : title;
        String l = loc.replaceAll("\\s{2,}", " ");
        it.loc = l.isEmpty() ? null : l;
        return it;
    }

    // ---- day heading
    private static int month(String name) {
        if (name.length() < 3) return -1;
        String k = name.substring(0, 3).toLowerCase(Locale.ROOT);
        for (int n = 0; n < 12; n++) if (MONTHS[n].equals(k)) return n;
        return -1;
    }

    private static LocalDate date(int y, int m0, int d, String yearGroup, LocalDate today) {
        try {
            LocalDate dt = LocalDate.of(y, m0 + 1, d);
            if (yearGroup == null && ChronoUnit.DAYS.between(today, dt) < -60) dt = LocalDate.of(y + 1, m0 + 1, d);
            return dt;
        } catch (DateTimeException e) {
            return null;
        }
    }

    static Day parseHeading(String r, LocalDate today) {
        r = r.trim();
        Day day = new Day();
        day.label = "";
        String s = r.toLowerCase(Locale.ROOT);
        Matcher m = ISO.matcher(r);
        if (m.find()) {
            try {
                day.date = LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)));
            } catch (DateTimeException e) { day.date = null; }
            day.label = m.group(4).trim();
            return day;
        }
        if (s.matches("^today\\b.*")) { day.date = today; day.label = r.substring(5).trim(); return day; }
        if (s.matches("^tomorrow\\b.*")) { day.date = today.plusDays(1); day.label = r.substring(8).trim(); return day; }
        String f = r;
        int wd = -1;
        m = WD.matcher(s);
        if (m.find()) {
            for (int n = 0; n < 7; n++) if (WDAYS[n].equals(m.group(1))) wd = n;
            f = r.substring(m.group(0).length()).trim();
        }
        m = MD.matcher(f);
        if (m.find() && month(m.group(1)) >= 0) {
            int y = m.group(3) != null ? Integer.parseInt(m.group(3)) : today.getYear();
            day.date = date(y, month(m.group(1)), Integer.parseInt(m.group(2)), m.group(3), today);
            day.label = day.date == null ? r : (m.group(4) == null ? "" : m.group(4).trim());
            return day;
        }
        m = DM.matcher(f);
        if (m.find() && month(m.group(2)) >= 0) {
            int y = m.group(3) != null ? Integer.parseInt(m.group(3)) : today.getYear();
            day.date = date(y, month(m.group(2)), Integer.parseInt(m.group(1)), m.group(3), today);
            day.label = day.date == null ? r : (m.group(4) == null ? "" : m.group(4).trim());
            return day;
        }
        if (wd >= 0 && f.isEmpty()) {
            int sunIdx = today.getDayOfWeek().getValue() % 7; // JS getDay(): Sun = 0
            day.date = today.plusDays((wd - sunIdx + 7) % 7);
            return day;
        }
        day.label = r;
        return day;
    }

    // ---- whole plan
    public static Plan parse(String text, LocalDate today) {
        Plan plan = new Plan();
        Day cur = null;
        for (String ln : text.split("\n", -1)) {
            Matcher h = HEADING.matcher(ln.trim());
            if (h.find()) {
                cur = parseHeading(h.group(1), today);
                plan.days.add(cur);
                continue;
            }
            Item it = parseItem(ln);
            if (it != null && cur != null) cur.items.add(it);
        }
        for (Day day : plan.days) {
            Integer y = null;
            for (Item it : day.items) {
                if (it.start != null && !it.floating) {
                    int e = it.end != null ? it.end : it.start;
                    y = (y != null && it.start < y) ? Math.max(y, e) : e;
                } else if (y != null) {
                    it.floating = true;
                    it.start = y;
                    if (it.dur != null && it.dur > 0) { it.end = it.start + it.dur; y = it.end; }
                    else it.end = it.start;
                } else {
                    it.floating = true;
                }
            }
        }
        return plan;
    }

    /** All sections for a date, merged in text order (a date can appear under several headings). */
    public Day day(LocalDate date) {
        Day out = null;
        for (Day d : days) {
            if (!date.equals(d.date)) continue;
            if (out == null) { out = new Day(); out.date = date; out.label = d.label; }
            else if (out.label.isEmpty()) out.label = d.label;
            out.items.addAll(d.items);
        }
        return out;
    }

    public static String hhmm(int min) {
        int i = ((min % 1440) + 1440) % 1440;
        return String.format(Locale.ROOT, "%02d:%02d", i / 60, i % 60);
    }

    public static String dur(Integer mins) {
        if (mins == null || mins <= 0) return "";
        int h = mins / 60, r = mins % 60;
        return h > 0 && r > 0 ? h + "h" + r + "m" : h > 0 ? h + "h" : r + "m";
    }
}
