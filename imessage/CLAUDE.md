# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

This repository (`bab_hacks`) is in early/placeholder state. The `imessage/` directory is the working directory for iMessage-related tooling or automation.

## Repository Structure

- The project lives under `bab_hacks/imessage/`
- A separate `Polymarket` branch exists in the remote for unrelated work

# iMessage Bot (LINQ)

This folder contains the **iMessage interface layer** for the Group Chat Hedge Funds project.

The goal of this component is to allow users to interact with the system **directly through iMessage commands**.

The bot parses messages, interprets commands, and forwards structured requests to the backend.

---

# System Architecture

iMessage Bot (LINQ)
        │
        ▼
Main Backend (Fund Logic)
        │
 ┌──────┼───────────┐
 │      │           │
Ripple  Polymarket  Liquid
Wallet  API         API

The backend orchestrates all trading logic.

This folder only implements the **messaging layer**.

---

# Folder Scope

This directory should ONLY contain code for:

• message listening  
• command parsing  
• command routing  
• response formatting  

No trading logic should live here.

---

# Supported Commands

/createfund  
/deposit  
/propose_trade  
/vote yes  
/vote no  
/portfolio  

Example:

User:
