import React, { useState, useEffect } from 'react';
import { Table, Upload, Button, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';

// Electron fs & path
const fs = window.require ? window.require('fs') : null;
const path = window.require ? window.require('path') : null;
const electron = window.require ? window.require('electron') : null;

// 解析成交金额，统一为“亿”
function parseAmount(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  let str = String(val).replace(/,/g, '').replace(/\s/g, '').trim();
  // 只保留数字、点、单位
  str = str.replace(/[^\d.万亿]/g, '');
  if (str.endsWith('亿')) return parseFloat(str);
  if (str.endsWith('万')) return parseFloat(str) / 10000;
  // 没有单位，假设是元
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str) / 1e8;
  return 0;
}

// 移除序号列
const columns = [
  { title: '行业', dataIndex: 'industry', key: 'industry' },
  { title: '股票数量', dataIndex: 'count', key: 'count' },
  { title: '成交总额（亿）', dataIndex: 'total', key: 'total' },
];

export default function UploadTable(props) {
  // dataByDate: { [date]: [row, ...] }
  const [dataByDate, setDataByDate] = useState({});
  const [currentDate, setCurrentDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [userDataPath, setUserDataPath] = useState('');
  const [dataFile, setDataFile] = useState('');

  // 初始化获取userData路径
  useEffect(() => {
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.invoke('get-user-data-path').then((p) => {
        setUserDataPath(p);
        setDataFile(path ? path.join(p, 'data.json') : '');
        // 加载本地数据
        if (fs && path) {
          const filePath = path.join(p, 'data.json');
          if (fs.existsSync(filePath)) {
            try {
              const raw = fs.readFileSync(filePath, 'utf-8');
              const local = JSON.parse(raw);
              setDataByDate(local);
              const dates = Object.keys(local);
              if (dates.length > 0) setCurrentDate(dates[dates.length - 1]);
            } catch {
              setDataByDate({});
            }
          }
        }
      });
    }
  }, []);

  // 多文件上传
  const handleFiles = async (fileList) => {
    console.log('handleFiles called', fileList);
    setLoading(true);
    let newDataByDate = { ...dataByDate };
    let anySuccess = false;
    for (const file of fileList) {
      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        // 防御性处理header
        let headerRows = [];
        try {
          headerRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        } catch (e) {
          console.error('读取header出错:', e);
        }
        const header = Array.isArray(headerRows) ? headerRows[0] || [] : [];
        console.log('header:', header);
        let amountCol = '';
        let dateFromHeader = '';
        for (const col of header) {
          if (!col) continue;
          const m = String(col).match(/(\d{8}).*金额$/);
          if (m) {
            amountCol = col;
            dateFromHeader = m[1];
            break;
          }
        }
        console.log('amountCol:', amountCol, 'dateFromHeader:', dateFromHeader);
        json.forEach(row => {
          try {
            if (!row) return;
            console.log('row:', row);
            const index = row['序'] || row['序号'] || row['编号'] || row['index'] || '';
            const industry = row['所属行业'] || row['行业'] || '未知';
            let date = dateFromHeader || '未知日期';
            let amount = amountCol ? row[amountCol] : '';
            if (!amount) {
              amount = row['成交金额'] || row['成交额'] || row['金额'] || '';
            }
            const parsedAmount = parseAmount(amount);
            if (!newDataByDate[date]) newDataByDate[date] = [];
            newDataByDate[date].push({
              index,
              industry,
              amount: parsedAmount,
            });
          } catch (rowErr) {
            console.error('解析行出错:', row, rowErr);
          }
        });
        anySuccess = true;
      } catch (err) {
        message.error(`${file.name} 解析失败`);
        console.error('解析文件出错:', file.name, err);
      }
    }
    if (anySuccess) {
      setDataByDate(newDataByDate);
      saveLocalData(newDataByDate);
      const dates = Object.keys(newDataByDate);
      if (dates.length > 0) setCurrentDate(dates[dates.length - 1]);
      message.success('上传并保存成功');
    }
    setLoading(false);
    return false;
  };

  // 保存本地数据
  function saveLocalData(data) {
    if (fs && dataFile) {
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf-8');
    }
  }

  // 处理表格数据（按行业聚合）
  const getTableData = () => {
    if (!currentDate || !dataByDate[currentDate]) {
      console.log('当前日期无数据', currentDate, dataByDate);
      return [];
    }
    const rows = dataByDate[currentDate];
    // 按行业聚合
    const industryMap = {};
    rows.forEach(row => {
      const { index, industry, amount } = row;
      if (!industryMap[industry]) {
        industryMap[industry] = { industry, count: 0, total: 0, index: index };
      }
      industryMap[industry].count += 1;
      industryMap[industry].total += amount;
    });
    // 保留序号（取第一个出现的）
    const result = Object.values(industryMap).map(item => ({
      ...item,
      total: item.total.toFixed(2),
    }));
    console.log('表格数据:', result);
    return result;
  };

  return (
    <div>
      <Upload
        accept=".xlsx,.xls,.csv"
        showUploadList={false}
        multiple
        beforeUpload={(file) => { handleFiles([file]); return false; }}
        disabled={loading}
      >
        <Button icon={<UploadOutlined />} loading={loading}>
          批量上传表格（支持 Excel/CSV）
        </Button>
      </Upload>
      <div style={{ marginTop: 16 }}>
        <b>当前数据日期：</b>{currentDate || '无'}
      </div>
      <div style={{ marginTop: 24 }}>
        <Table
          columns={columns}
          dataSource={getTableData()}
          rowKey="industry"
          pagination={false}
          locale={{ emptyText: '暂无数据' }}
        />
      </div>
    </div>
  );
} 