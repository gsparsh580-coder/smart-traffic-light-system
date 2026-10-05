#!/usr/bin/env python3
"""
Generates a comprehensive PDF document containing the project documentation,
circuit wiring guide, system architecture, and ALL source codes.
"""

import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Preformatted, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super(NumberedCanvas, self).__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_page_decorations(self, page_count):
        self.saveState()
        # Suppress on page 1 (cover)
        if self._pageNumber > 1:
            self.setFont("Helvetica", 8)
            self.setFillColor(HexColor("#64748B"))
            # Header
            self.drawString(54, 750, "Smart Traffic Light Control System - Complete Code & Documentation")
            self.setStrokeColor(HexColor("#CBD5E1"))
            self.setLineWidth(0.5)
            self.line(54, 744, 558, 744)

            # Footer
            self.line(54, 45, 558, 45)
            self.drawString(54, 32, "Author: Sparsh Goel | GitHub: @gsparsh580-coder")
            page_text = f"Page {self._pageNumber} of {page_count}"
            self.drawRightString(558, 32, page_text)
        self.restoreState()


def build_pdf(filename="Smart_Traffic_Light_System_Complete_Code.pdf"):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()

    # Custom styles
    c_primary = HexColor("#0F172A")
    c_accent = HexColor("#0D9488")
    c_blue = HexColor("#0284C7")
    c_code_bg = HexColor("#F8FAFC")
    c_code_border = HexColor("#E2E8F0")

    styles.add(ParagraphStyle(
        'CoverTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=28,
        leading=34,
        textColor=c_primary,
        alignment=0,
        spaceAfter=12
    ))

    styles.add(ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=15,
        leading=20,
        textColor=c_accent,
        spaceAfter=20
    ))

    styles.add(ParagraphStyle(
        'CoverMeta',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        leading=16,
        textColor=HexColor("#475569")
    ))

    styles.add(ParagraphStyle(
        'SecHeading',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        textColor=c_primary,
        spaceBefore=18,
        spaceAfter=8,
        keepWithNext=True
    ))

    styles.add(ParagraphStyle(
        'SubHeading',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=17,
        textColor=c_blue,
        spaceBefore=12,
        spaceAfter=6,
        keepWithNext=True
    ))

    styles.add(ParagraphStyle(
        'BodyDark',
        parent=styles['BodyText'],
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=HexColor("#1E293B"),
        spaceAfter=8
    ))

    styles.add(ParagraphStyle(
        'CodeStyle',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=7.2,
        leading=9.5,
        textColor=HexColor("#0F172A")
    ))

    story = []

    # -------------------------------------------------------------
    # 1. COVER PAGE
    # -------------------------------------------------------------
    story.append(Spacer(1, 40))
    story.append(HRFlowable(width="100%", thickness=6, color=c_accent, spaceBefore=0, spaceAfter=20))
    story.append(Paragraph("SMART TRAFFIC LIGHT<br/>CONTROL SYSTEM", styles['CoverTitle']))
    story.append(Paragraph("Dual-Mode IoT Architecture: Synthetic Traffic Simulation & Real ESP32 Sensors", styles['CoverSubtitle']))
    story.append(HRFlowable(width="100%", thickness=1, color=HexColor("#CBD5E1"), spaceBefore=10, spaceAfter=25))

    meta_text = """
    <b>Project Title:</b> Smart Traffic Light Management System<br/>
    <b>Author / Maintainer:</b> Sparsh Goel<br/>
    <b>GitHub Profile:</b> @gsparsh580-coder<br/>
    <b>GitHub Repository:</b> https://github.com/gsparsh580-coder/smart-traffic-light-system<br/>
    <b>Live Web Dashboard:</b> https://gsparsh580-coder.github.io/smart-traffic-light-system/<br/>
    <b>Communication Protocols:</b> HiveMQ MQTT (TCP 1883 & WebSocket WSS 8884)<br/>
    <b>Hardware Controller:</b> ESP32 DevKit V1 (HC-SR04 Ultrasonic Sensors + 12 Traffic LEDs)<br/>
    <b>Software Stack:</b> Node-RED Dynamic Controller, Python Traffic Simulator, Tailwind HTML5 Web App<br/>
    <b>Date:</b> October 2026
    """
    story.append(Paragraph(meta_text, styles['CoverMeta']))
    story.append(Spacer(1, 50))

    summary_box_data = [[
        Paragraph(
            "<b>Executive Summary:</b><br/>"
            "This document provides the complete source code, hardware circuit schematics, communication specifications, "
            "and deployment instructions for an intelligent traffic control system. The system dynamically computes green "
            "light timing based on queue density, provides instant priority preemption for emergency vehicles, and operates "
            "in dual data ingestion modes: synthetic Poisson arrivals and physical ESP32 ultrasonic telemetry.",
            styles['BodyDark']
        )
    ]]
    summary_table = Table(summary_box_data, colWidths=[504])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), HexColor("#F1F5F9")),
        ('BOX', (0,0), (-1,-1), 1, HexColor("#CBD5E1")),
        ('TOPPADDING', (0,0), (-1,-1), 12),
        ('BOTTOMPADDING', (0,0), (-1,-1), 12),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
    ]))
    story.append(summary_table)

    story.append(PageBreak())

    # -------------------------------------------------------------
    # 2. SYSTEM ARCHITECTURE & TOPICS
    # -------------------------------------------------------------
    story.append(Paragraph("1. System Architecture & MQTT Topic Schema", styles['SecHeading']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_primary, spaceBefore=2, spaceAfter=12))

    story.append(Paragraph(
        "The system decouples edge hardware and web supervisors through HiveMQ MQTT broker. "
        "Either the Python simulation generator or physical ESP32 publishes vehicle densities. "
        "Node-RED ingests this stream, calculates adaptive green durations, and publishes actuation commands back to the lights.",
        styles['BodyDark']
    ))

    mqtt_table_data = [
        ["Topic", "Payload Type", "Function"],
        ["smart_traffic/demo/system/mode", "JSON String", "Toggles SYNTHETIC vs REAL_ESP32 data mode"],
        ["smart_traffic/demo/lane1/density", "JSON Object", "Northbound queue size & ultrasonic distance (cm)"],
        ["smart_traffic/demo/lane2/density", "JSON Object", "Eastbound queue size & ultrasonic distance (cm)"],
        ["smart_traffic/demo/lane3/density", "JSON Object", "Southbound queue size & ultrasonic distance (cm)"],
        ["smart_traffic/demo/lane4/density", "JSON Object", "Westbound queue size & ultrasonic distance (cm)"],
        ["smart_traffic/demo/control/lights", "JSON Object", "Master 4-way active states, countdown, and phases"],
        ["smart_traffic/demo/lane[1-4]/light", "String (Enum)", "Discrete GPIO light commands (RED, YELLOW, GREEN)"],
        ["smart_traffic/demo/control/emergency", "JSON Object", "Emergency vehicle preemption trigger (OVERRIDE / CLEAR)"],
        ["smart_traffic/demo/control/manual", "JSON Object", "Operator override commands (FORCE_LANE, ALL_RED, AUTO)"]
    ]
    t_mqtt = Table(mqtt_table_data, colWidths=[170, 94, 240])
    t_mqtt.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), HexColor("#1E293B")),
        ('TEXTCOLOR', (0,0), (-1,0), HexColor("#FFFFFF")),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('GRID', (0,0), (-1,-1), 0.5, HexColor("#CBD5E1")),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [HexColor("#FFFFFF"), HexColor("#F8FAFC")]),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_mqtt)
    story.append(Spacer(1, 14))

    # -------------------------------------------------------------
    # 3. HARDWARE & WIRING GUIDE
    # -------------------------------------------------------------
    story.append(Paragraph("2. ESP32 Hardware Pinouts & Circuit Configuration", styles['SecHeading']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_primary, spaceBefore=2, spaceAfter=12))

    hw_table_data = [
        ["Intersection Lane", "Ultrasonic Sensor (HC-SR04)", "Red LED", "Yellow LED", "Green LED"],
        ["Lane 1 (North)", "Trig: GPIO 5, Echo: GPIO 18", "GPIO 13", "GPIO 12", "GPIO 14"],
        ["Lane 2 (East)", "Trig: GPIO 19, Echo: GPIO 21", "GPIO 27", "GPIO 33", "GPIO 32"],
        ["Lane 3 (South)", "Trig: GPIO 22, Echo: GPIO 23", "GPIO 15", "GPIO 2", "GPIO 4"],
        ["Lane 4 (West)", "Trig: GPIO 25, Echo: GPIO 26", "GPIO 16", "GPIO 17", "GPIO 5"],
        ["Emergency Override", "Push Button: GPIO 34 (INPUT_PULLUP)", "--", "--", "--"],
        ["Heartbeat / Status", "Onboard Blue LED: GPIO 2", "--", "--", "--"]
    ]
    t_hw = Table(hw_table_data, colWidths=[100, 154, 75, 75, 100])
    t_hw.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), HexColor("#0D9488")),
        ('TEXTCOLOR', (0,0), (-1,0), HexColor("#FFFFFF")),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('GRID', (0,0), (-1,-1), 0.5, HexColor("#CBD5E1")),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [HexColor("#FFFFFF"), HexColor("#F8FAFC")]),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_hw)
    story.append(Spacer(1, 14))

    # Helper function to append code files nicely
    def append_code_section(title, file_rel_path, lang_desc):
        story.append(PageBreak())
        story.append(Paragraph(f"Code Listing: {title}", styles['SecHeading']))
        story.append(Paragraph(f"<b>Path:</b> <font color='#0284C7'>{file_rel_path}</font> | <b>Type:</b> {lang_desc}", styles['BodyDark']))
        story.append(HRFlowable(width="100%", thickness=1, color=HexColor("#CBD5E1"), spaceBefore=2, spaceAfter=8))

        full_path = os.path.join(r"C:\Users\sparsh\Documents\antigravity\wise-bardeen", file_rel_path)
        if os.path.exists(full_path):
            with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
                code_text = f.read()

            # Split code into chunks of max 65 lines so reportlab flows across pages smoothly
            lines = code_text.splitlines()
            chunk_size = 62
            for i in range(0, len(lines), chunk_size):
                chunk = "\n".join(lines[i:i+chunk_size])
                # Sanitize tabs
                chunk = chunk.replace("\t", "    ")
                
                # Wrap in styled table box
                pre = Preformatted(chunk, styles['CodeStyle'])
                t_box = Table([[pre]], colWidths=[504])
                t_box.setStyle(TableStyle([
                    ('BACKGROUND', (0,0), (-1,-1), c_code_bg),
                    ('BOX', (0,0), (-1,-1), 0.5, c_code_border),
                    ('TOPPADDING', (0,0), (-1,-1), 6),
                    ('BOTTOMPADDING', (0,0), (-1,-1), 6),
                    ('LEFTPADDING', (0,0), (-1,-1), 8),
                    ('RIGHTPADDING', (0,0), (-1,-1), 8),
                ]))
                story.append(t_box)
                story.append(Spacer(1, 6))
        else:
            story.append(Paragraph(f"File not found: {file_rel_path}", styles['BodyDark']))

    # -------------------------------------------------------------
    # 4. APPEND ALL COMPLETE SOURCE CODE LISTINGS
    # -------------------------------------------------------------
    append_code_section("1. ESP32 Arduino Firmware", "esp32_firmware/esp32_smart_traffic.ino", "C++ / Arduino Sketch")
    append_code_section("2. ESP32 Secrets Configuration Template", "esp32_firmware/secrets.h.example", "C++ Header")
    append_code_section("3. Python Synthetic Traffic Simulator", "simulator/traffic_simulator.py", "Python 3")
    append_code_section("4. Traffic Simulation Presets", "simulator/scenarios.json", "JSON Dataset")
    append_code_section("5. Node-RED Dynamic Logic Flow", "node_red/flows.json", "Node-RED Flow JSON")
    append_code_section("6. Live Web Dashboard UI", "index.html", "HTML5 & Tailwind CSS")
    append_code_section("7. Web Dashboard JavaScript & Animation Engine", "js/app.js", "Vanilla JavaScript (MQTT.js & Canvas)")
    append_code_section("8. Dashboard Styling & Animations", "css/style.css", "CSS3")
    append_code_section("9. GitHub Actions CI/CD Deployment", ".github/workflows/deploy.yml", "YAML Workflow")

    # Build the document
    doc.build(story, canvasmaker=NumberedCanvas)
    print("PDF generation complete.")

if __name__ == "__main__":
    build_pdf()
