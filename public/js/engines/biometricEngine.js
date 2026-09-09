// ==========================================
// Biometric Device Integration & Attendance Engine
// ==========================================

import { storage } from '../storage.js';
import { tf } from '../i18n.js';

export const BIOMETRIC_PROTOCOLS = [
  { id: 'zkteco_standalone', name: 'ZKTeco Standalone (TCP/IP Port 4370)' },
  { id: 'hikvision_api', name: 'Hikvision Access & Attendance API' },
  { id: 'suprema_biostar', name: 'Suprema BioStar API' },
  { id: 'rest_cloud_api', name: 'Custom Cloud Webhook / REST API' },
];

/**
 * Test connection to biometric device (simulated TCP/IP socket ping)
 */
export async function testBiometricConnection(config) {
  return new Promise((resolve) => {
    setTimeout(() => {
      if (!config.ipAddress) {
        resolve({ success: false, message: tf('att.biometricIpRequired') });
        return;
      }
      resolve({
        success: true,
        message: tf('att.biometricConnected', { address: `${config.ipAddress}:${config.port || 4370}` }),
        deviceInfo: {
          serialNumber: 'ZK-HRMS-892019',
          firmware: 'Ver 6.80 May 2026',
          usersCountOnDevice: 42,
          logsCount: 158,
        },
      });
    }, 600);
  });
}

/**
 * Sync & Pull attendance logs from device or simulate real pull
 */
export async function syncBiometricLogs(config, employees) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const today = new Date().toISOString().split('T')[0];
      const newLogs = [];

      // Generate verified attendance checks for active employees
      employees.forEach((emp) => {
        newLogs.push({
          id: `att-bio-${emp.id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          companyId: emp.companyId || '',
          branchId: emp.branchId || '',
          employeeId: emp.id,
          date: today,
          checkIn: '08:00',
          checkOut: '17:00',
          lateMinutes: 0,
          status: 'present',
          source: 'biometric_device',
          notes: tf('att.biometricNote'),
          createdAt: new Date().toISOString(),
        });
      });

      // Save into storage
      const state = storage.getState();
      const currentAttendance = state.attendance || [];

      // Replace only today's machine-sourced biometric entries so manually
      // recorded attendance and absence records are never overwritten.
      const filtered = currentAttendance.filter((a) => !(a.date === today && a.source === 'biometric_device'));
      storage.saveAttendance([...newLogs, ...filtered]);

      resolve({
        success: true,
        syncedCount: newLogs.length,
        message: tf('att.biometricSynced', { count: newLogs.length, date: today }),
      });
    }, 800);
  });
}

/**
 * Check whether a date falls on a configured weekly day off.
 * Day numbers follow JS convention: 0=Sunday ... 6=Saturday. Default: Sat & Sun.
 */
export function isWeekend(dateString, weekendDays = [6, 0]) {
  if (!dateString) return false;
  const d = new Date(dateString);
  return Array.isArray(weekendDays) && weekendDays.includes(d.getDay());
}

/**
 * Legacy helper retained for compatibility — equivalent to isWeekend with the
 * Friday-only (single weekly off day) configuration.
 */
export function isFridayWeekend(dateString) {
  return isWeekend(dateString, [5]);
}

/**
 * Check if date falls within official paid company holidays
 */
export function isCompanyHoliday(dateString, holidays = []) {
  if (!dateString || !holidays.length) return null;
  const checkDate = new Date(dateString);

  return holidays.find((h) => {
    const start = new Date(h.startDate);
    const end = new Date(h.endDate);
    return checkDate >= start && checkDate <= end;
  });
}
